import { streamText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buildSystemPrompt } from '@/lib/ai/system-prompt'
import {
  getUpcomingReservationsTool,
  getPricingForPeriodTool,
  getCalendarTool,
  getMonthlyRevenueTool,
  getPropertyMetricsTool,
  getReviewsTool,
  getReviewStatsTool,
  getLastCleaningTool,
  getMaintenanceTool,
  getInventoryAlertsTool,
  getFullInventoryTool,
  searchKnowledgeTool,
  createSupportTicketTool,
  getRevenueStrategyTool,
} from '@/lib/ai/tools'

export const maxDuration = 60

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, propertyId } = body

    if (!propertyId) {
      return new Response(JSON.stringify({ error: 'propertyId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Authenticate ──────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Load owner + property ─────────────────────────────────────
    const sb = createServiceClient() as any

    const ownerRes = await sb.from('owners').select('*').eq('supabase_user_id', user.id).single()
    const propertyRes = await sb.from('properties').select('*').eq('id', propertyId).single()

    if (ownerRes.error || !ownerRes.data) {
      return new Response(JSON.stringify({ error: 'Owner not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (propertyRes.error || !propertyRes.data) {
      return new Response(JSON.stringify({ error: 'Property not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const owner = ownerRes.data
    const property = propertyRes.data

    const ADMIN_EMAILS = ['se@nok.rent']
    const isAdmin = ADMIN_EMAILS.includes(owner.email)
    if (!isAdmin && property.owner_id !== owner.id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Check API key ───────────────────────────────────────────────
    const apiKey = process.env.NOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const anthropic = createAnthropic({ apiKey })

    // ── Build tools with property context ─────────────────────────
    const tools = {
      getUpcomingReservations: getUpcomingReservationsTool(propertyId),
      getPricingForPeriod: getPricingForPeriodTool(propertyId),
      getCalendar: getCalendarTool(propertyId),
      getMonthlyRevenue: getMonthlyRevenueTool(propertyId),
      getPropertyMetrics: getPropertyMetricsTool(propertyId),
      getReviews: getReviewsTool(propertyId),
      getReviewStats: getReviewStatsTool(propertyId),
      getLastCleaning: getLastCleaningTool(propertyId),
      getMaintenance: getMaintenanceTool(propertyId),
      getInventoryAlerts: getInventoryAlertsTool(propertyId),
      getFullInventory: getFullInventoryTool(propertyId),
      searchKnowledge: searchKnowledgeTool(),
      createSupportTicket: createSupportTicketTool(propertyId, owner.id),
      getRevenueStrategy: getRevenueStrategyTool(property),
    }

    // ── Convert UIMessages to CoreMessages ──────────────────────────
    const coreMessages = (messages ?? []).map((m: any) => {
      // If message has parts (UIMessage format), extract text content
      if (m.parts) {
        const textParts = m.parts.filter((p: any) => p.type === 'text')
        const content = textParts.map((p: any) => p.text).join('')
        return { role: m.role, content }
      }
      // Already CoreMessage format
      return { role: m.role, content: m.content }
    })

    // ── Save user message to DB ───────────────────────────────────
    const lastMsg = coreMessages.at(-1)
    if (lastMsg?.role === 'user') {
      await sb.from('chat_messages').insert({
        property_id: propertyId,
        owner_id: owner.id,
        role: 'user',
        content: lastMsg.content,
      })
    }

    // ── Stream AI response ────────────────────────────────────────
    const result = streamText({
      model: anthropic('claude-sonnet-4-6'),
      system: buildSystemPrompt(property, owner),
      messages: coreMessages,
      tools,
      stopWhen: stepCountIs(5),
      temperature: 0.3,
      onFinish: async ({ text }) => {
        if (text) {
          await sb.from('chat_messages').insert({
            property_id: propertyId,
            owner_id: owner.id,
            role: 'assistant',
            content: text,
          })
        }
      },
    })

    return result.toUIMessageStreamResponse()
  } catch (error) {
    console.error('Chat API error:', error)
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
