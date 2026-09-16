/**
 * Briefing semanal IA para un edificio (net-commission) + cálculo de "facts".
 *
 * Igual que lib/ai/briefing.ts pero a nivel edificio: se genera una vez por
 * config/semana/idioma y se cachea en building_ai_briefings. Los facts salen
 * SOLO de reservations / pricing_calendar / rate_snapshots (nunca del motor de
 * revenue por unidad — demasiado caro para 20 unidades).
 */

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/server'
import { loadMonthlyFx, type MonthlyFx } from '@/lib/trm'
import { overlapNights, prorate } from '@/lib/building-pnl'
import type { BuildingConfig } from '@/lib/building-pnl'

// ── fechas (siempre strings YYYY-MM-DD, sin Date locales) ──────────────────

export function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const VALID_STATUSES = ['confirmed', 'checked_in', 'checked_out']

export interface UnitFacts {
  id: string
  name: string
  active: boolean
  occ30: number            // 0–100
  occ60: number
  occ90: number
  nights30Past: number
  adr30: number | null     // USD neto por noche, últimos 30 días
  nextCheckIn: string | null
  rateToday: number | null
  rateAvg30: number | null
  rateCurrency: string
  rateSeries: (number | null)[]   // próximos 30 días (para sparkline)
}

export interface BuildingFacts {
  buildingName: string
  units: number
  activeUnits: number
  occNext30: number        // 0–100
  occNext60: number
  occNext90: number
  occLast30: number
  adrLast30: number | null // USD
  newBookings7d: number
  newBookingsNetUSD: number
  topUnitsNext30: { name: string; occ: number }[]
  bottomUnitsNext30: { name: string; occ: number }[]
  unitsWithoutBookingsNext30: number
  avgPublishedRateNext30: number | null
  publishedRateCurrency: string
  perUnit: UnitFacts[]
}

/** Facts a partir de Supabase. Una sola tanda de consultas para todo el edificio. */
export async function computeBuildingFacts(
  sb: any,
  config: { id: string; name: string },
  properties: { id: string; name: string; active: boolean }[],
): Promise<BuildingFacts> {
  const today = todayYmd()
  const from = addDays(today, -30)
  const toExclusive = addDays(today, 90)
  const to30 = addDays(today, 30)
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const ids = properties.map(p => p.id)
  const idList = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
  const months = Array.from(new Set([from.slice(0, 7), today.slice(0, 7)]))

  const [resRes, newRes, pcRes, snapRes, fx] = await Promise.all([
    sb.from('reservations')
      .select('property_id, check_in, check_out, nights, owner_revenue, currency, is_blocked, status')
      .in('property_id', idList).in('status', VALID_STATUSES)
      .lt('check_in', toExclusive).gt('check_out', from).limit(5000),
    sb.from('reservations')
      .select('property_id, owner_revenue, currency, check_in')
      .in('property_id', idList).in('status', ['confirmed', 'checked_in'])
      .gte('guesty_created_at', since7d).limit(500),
    sb.from('pricing_calendar')
      .select('property_id, calendar_date, base_rate, currency')
      .in('property_id', idList).gte('calendar_date', today).lt('calendar_date', to30).limit(5000),
    sb.from('rate_snapshots').select('property_id, prices').in('property_id', idList),
    loadMonthlyFx(months) as Promise<MonthlyFx>,
  ])

  const reservations: any[] = (resRes.data ?? []).filter((r: any) => r.is_blocked !== true)
  const newBookings: any[] = (newRes.data ?? []).filter((r: any) => r.is_blocked !== true)

  // Tarifas publicadas: pricing_calendar primero, rate_snapshots como respaldo
  const rates = new Map<string, Map<string, number>>()
  let rateCurrency = 'USD'
  for (const row of (snapRes.data ?? []) as any[]) {
    const m = new Map<string, number>()
    for (const [d, v] of Object.entries(row.prices ?? {})) if (typeof v === 'number' && v > 0) m.set(d, v)
    rates.set(row.property_id, m)
  }
  for (const row of (pcRes.data ?? []) as any[]) {
    if (!(row.base_rate > 0)) continue
    if (!rates.has(row.property_id)) rates.set(row.property_id, new Map())
    rates.get(row.property_id)!.set(row.calendar_date, Number(row.base_rate))
    if (row.currency) rateCurrency = row.currency
  }

  const days30 = Array.from({ length: 30 }, (_, i) => addDays(today, i))
  const perUnit: UnitFacts[] = []
  let sumRates = 0, countRates = 0
  let nights30 = 0, nights60 = 0, nights90 = 0, nightsPast = 0, netPast = 0

  for (const p of properties) {
    const mine = reservations.filter(r => r.property_id === p.id)
    const n = (start: string, endInclusive: string) => mine.reduce((s, r) => s + overlapNights(r.check_in, r.check_out, start, endInclusive), 0)
    const u30 = n(today, addDays(today, 29))
    const u60 = n(today, addDays(today, 59))
    const u90 = n(today, addDays(today, 89))
    const uPast = n(from, addDays(today, -1))
    let uNet = 0
    for (const r of mine) {
      const usd = fx.toUSD(Number(r.owner_revenue) || 0, r.currency, r.check_in)
      uNet += prorate(usd, r.nights ?? 0, r.check_in, r.check_out, from, addDays(today, -1))
    }
    if (p.active) { nights30 += u30; nights60 += u60; nights90 += u90; nightsPast += uPast; netPast += uNet }

    const next = mine.filter(r => r.check_in >= today).map(r => r.check_in).sort()[0] ?? null
    const rm = rates.get(p.id)
    const series = days30.map(d => rm?.get(d) ?? null)
    const present = series.filter((v): v is number => v != null)
    if (present.length) { sumRates += present.reduce((a, b) => a + b, 0); countRates += present.length }

    perUnit.push({
      id: p.id, name: p.name, active: p.active,
      occ30: Math.round((u30 / 30) * 100), occ60: Math.round((u60 / 60) * 100), occ90: Math.round((u90 / 90) * 100),
      nights30Past: uPast,
      adr30: uPast > 0 ? Math.round(uNet / uPast) : null,
      nextCheckIn: next,
      rateToday: rm?.get(today) ?? null,
      rateAvg30: present.length ? Math.round(present.reduce((a, b) => a + b, 0) / present.length) : null,
      rateCurrency,
      rateSeries: series,
    })
  }

  const active = properties.filter(p => p.active).length || 1
  const occ = (nights: number, days: number) => Math.round((nights / (active * days)) * 100)
  const activeUnits = perUnit.filter(u => u.active)
  const byOcc = [...activeUnits].sort((a, b) => b.occ30 - a.occ30 || a.name.localeCompare(b.name, 'es', { numeric: true }))

  return {
    buildingName: config.name,
    units: properties.length,
    activeUnits: active,
    occNext30: occ(nights30, 30), occNext60: occ(nights60, 60), occNext90: occ(nights90, 90),
    occLast30: occ(nightsPast, 30),
    adrLast30: nightsPast > 0 ? Math.round(netPast / nightsPast) : null,
    newBookings7d: newBookings.length,
    newBookingsNetUSD: Math.round(newBookings.reduce((s, r) => s + fx.toUSD(Number(r.owner_revenue) || 0, r.currency, r.check_in || today), 0)),
    topUnitsNext30: byOcc.slice(0, 3).map(u => ({ name: u.name, occ: u.occ30 })),
    bottomUnitsNext30: byOcc.slice(-3).reverse().map(u => ({ name: u.name, occ: u.occ30 })),
    unitsWithoutBookingsNext30: activeUnits.filter(u => u.occ30 === 0).length,
    avgPublishedRateNext30: countRates ? Math.round(sumRates / countRates) : null,
    publishedRateCurrency: rateCurrency,
    perUnit,
  }
}

// ── briefing ───────────────────────────────────────────────────────────────

function mondayOf(d: Date): string {
  const x = new Date(d)
  const day = x.getDay() || 7
  x.setDate(x.getDate() - day + 1)
  return x.toISOString().slice(0, 10)
}

/** Devuelve el briefing (cacheado por semana) o null si no hay API key / falla. Nunca lanza. */
export async function getBuildingBriefing(
  config: Pick<BuildingConfig, 'id' | 'name'>,
  facts: BuildingFacts,
  locale: 'es' | 'en',
): Promise<string | null> {
  const weekStart = mondayOf(new Date())
  let sb: any
  try {
    sb = createServiceClient() as any
    const { data: cached, error } = await sb
      .from('building_ai_briefings').select('content')
      .eq('config_id', config.id).eq('week_start', weekStart).eq('locale', locale).maybeSingle()
    if (cached?.content) return cached.content
    // Tabla ausente (migración 029 sin aplicar): sin cache no generamos — evitaría
    // una llamada al modelo en CADA render de la página hasta que exista la tabla.
    if (error) return null
  } catch {
    return null
  }

  const apiKey = process.env.NOK_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null

  try {
    const { perUnit: _omit, ...compact } = facts
    void _omit
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      temperature: 0.4,
      system: locale === 'en'
        ? 'You write a warm, concise weekly briefing (3-4 sentences, no lists, no emojis) for the owner of a whole building of short-term rental units, based ONLY on the JSON facts given. Never invent numbers; only quote numbers that appear in the facts. Occupancy values are percentages; money is USD. Refer to the pricing service as "NOK Revenue Management" — never mention external tools. Say "area" for the comparable market. If a fact is null, skip it. Plain text only.'
        : 'Escribes un briefing semanal cálido y conciso (3-4 frases, sin listas, sin emojis) para el propietario de un edificio completo de unidades de alquiler de corto plazo, basado SOLO en los datos JSON entregados. Nunca inventes números; cita únicamente cifras que aparezcan en los datos. Las ocupaciones son porcentajes; el dinero está en USD. Trata al propietario de tú. El servicio de precios se llama "Revenue Management NOK" — nunca menciones herramientas externas. Di "zona" para el mercado comparable (nunca "barrio"). Si un dato es null, omítelo. Solo texto plano.',
      messages: [{ role: 'user', content: `Datos de la semana para el edificio ${config.name}: ${JSON.stringify(compact)}` }],
    })
    const text = res.content.find((b: any) => b.type === 'text') as any
    const content: string | undefined = text?.text?.trim()
    if (!content) return null
    try {
      await sb.from('building_ai_briefings').upsert({ config_id: config.id, week_start: weekStart, locale, content })
    } catch { /* sin cache, pero devolvemos el texto */ }
    return content
  } catch {
    return null
  }
}
