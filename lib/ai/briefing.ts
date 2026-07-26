/**
 * Weekly AI briefing for the owner dashboard.
 * Generated once per property per week (per locale) with the same live data
 * the Strategy tab shows, cached in ai_weekly_briefings. Lazy: generated on
 * first view of the week; subsequent views hit the cache.
 */

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'

function mondayOf(d: Date): string {
  const x = new Date(d)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x.toISOString().slice(0, 10)
}

export interface BriefingFacts {
  propertyName: string
  newBookings7d: number
  newBookingsRevenueUSD: number
  newReviews7d: { score: number | null }[]
  rateChanges7d: number
  occNext30: number | null      // 0..1
  zoneOccNext30: number | null  // 0..1
  revenueScore30: number | null
  todayPrice: number | null
}

export async function getWeeklyBriefing(propertyId: string, facts: BriefingFacts, locale: 'es' | 'en'): Promise<string | null> {
  const sb = createServiceClient() as any
  const weekStart = mondayOf(new Date())

  const { data: cached } = await sb
    .from('ai_weekly_briefings')
    .select('content')
    .eq('property_id', propertyId)
    .eq('week_start', weekStart)
    .eq('locale', locale)
    .maybeSingle()
  if (cached?.content) return cached.content

  const apiKey = process.env.NOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      temperature: 0.4,
      system: locale === 'en'
        ? 'You write a warm, concise weekly briefing (2-3 sentences, no lists, no emojis) for a property owner about their short-term rental, based ONLY on the facts given. Never invent numbers. Refer to the service as "NOK Revenue Management" — never mention external tools. Say "area" for the comparable market. If a fact is null, skip it. Plain text only.'
        : 'Escribes un briefing semanal cálido y conciso (2-3 frases, sin listas, sin emojis) para el propietario de un alquiler de corto plazo, basado SOLO en los datos entregados. Nunca inventes números. El servicio se llama "Revenue Management NOK" — nunca menciones herramientas externas. Di "zona" para el mercado comparable (nunca "barrio"). Si un dato es null, omítelo. Solo texto plano.',
      messages: [{
        role: 'user',
        content: `Datos de la semana para ${facts.propertyName}: ${JSON.stringify(facts)}`,
      }],
    })
    const text = res.content.find((b: any) => b.type === 'text') as any
    const content = text?.text?.trim()
    if (!content) return null

    await sb.from('ai_weekly_briefings').upsert({
      property_id: propertyId, week_start: weekStart, locale, content,
    })
    return content
  } catch {
    return null
  }
}
