import { streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { resolveBuilding } from '@/lib/edificio'
import { getLocale } from '@/lib/i18n'
import { buildBuildingSystemPrompt } from '@/lib/ai/building-system-prompt'
import { buildBuildingTools } from '@/lib/ai/building-tools'
import { searchKnowledgeTool, createSupportTicketTool } from '@/lib/ai/tools'

export const maxDuration = 60

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, configId } = body as { messages?: any[]; configId?: string }
    if (!configId) return json({ error: 'configId is required' }, 400)

    // ── Auth ─────────────────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)

    const sb = createServiceClient() as any
    const { data: owner } = await sb.from('owners').select('id, name, email, additional_emails, locale').eq('supabase_user_id', user.id).single()
    if (!owner) return json({ error: 'Owner not found' }, 404)

    const building = await resolveBuilding(sb, configId, owner, isAdminEmail(owner.email))
    if (!building) return json({ error: 'Forbidden' }, 403)
    const { config, properties, propertyIds } = building

    const apiKey = process.env.NOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500)
    const anthropic = createAnthropic({ apiKey })

    const locale = owner.locale === 'en' ? 'en' : await getLocale()

    // ── Tools con contexto del edificio ───────────────────────────────
    const tools = {
      ...buildBuildingTools({ configId, propertyIds, properties, config }),
      searchKnowledge: searchKnowledgeTool(),
      ...(propertyIds[0] ? { createSupportTicket: createSupportTicketTool(propertyIds[0], owner.id) } : {}),
    }

    // ── UIMessages → CoreMessages ────────────────────────────────────
    const coreMessages = (messages ?? []).map((m: any) => {
      if (m.parts) {
        const content = m.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('')
        return { role: m.role, content }
      }
      return { role: m.role, content: m.content }
    })

    const lastMsg = coreMessages.at(-1)
    if (lastMsg?.role === 'user') {
      await sb.from('chat_messages').insert({ building_id: configId, property_id: null, owner_id: owner.id, role: 'user', content: lastMsg.content })
    }

    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: buildBuildingSystemPrompt(config, properties, owner, locale),
      messages: coreMessages,
      tools,
      stopWhen: stepCountIs(6),
      temperature: 0.3,
      onFinish: async ({ text }) => {
        if (text) {
          await sb.from('chat_messages').insert({ building_id: configId, property_id: null, owner_id: owner.id, role: 'assistant', content: text })
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error('Building chat API error:', error)
    return json({ error: error instanceof Error ? error.message : 'Internal server error' }, 500)
  }
}
