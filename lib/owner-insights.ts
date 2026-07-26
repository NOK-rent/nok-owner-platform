/**
 * Owner-facing insights computed from the portal's own data (Supabase),
 * optionally blended with market context from Revenue Management.
 * All amounts are converted to USD.
 */

import { fxToUSD, type YearVsMarketMonth } from '@/lib/wheelhouse'

type Sb = any

const ACTIVE_STATUSES = ['confirmed', 'checked_in', 'checked_out']

function overlapNights(checkIn: string, checkOut: string, winStart: string, winEndExcl: string): number {
  const a = checkIn > winStart ? checkIn : winStart
  const b = checkOut < winEndExcl ? checkOut : winEndExcl
  if (b <= a) return 0
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)
}

async function toUSD(amount: number, currency: string | null): Promise<number> {
  if (!amount) return 0
  return fxToUSD(amount, currency || 'USD')
}

interface ResRow {
  check_in: string
  check_out: string
  nights: number
  owner_revenue: number | null
  total_price: number | null
  currency: string | null
  status: string
  guesty_created_at: string | null
  guest_name: string | null
  channel: string | null
}

async function loadYearReservations(sb: Sb, propertyId: string): Promise<ResRow[]> {
  const year = new Date().getFullYear()
  const { data } = await sb
    .from('reservations')
    .select('check_in, check_out, nights, owner_revenue, total_price, currency, status, guesty_created_at, guest_name, channel')
    .eq('property_id', propertyId)
    .in('status', ACTIVE_STATUSES)
    .eq('is_blocked', false)
    .gte('check_out', `${year}-01-01`)
    .lte('check_in', `${year + 1}-03-31`)
  return (data ?? []) as ResRow[]
}

// ── 1. Year-end projection ──────────────────────────────────────────────────

export interface YearProjection {
  year: number
  ytdUSD: number             // realized (nights already slept)
  confirmedFutureUSD: number // confirmed bookings not yet stayed (rest of year)
  estimatedExtraUSD: number  // model estimate for still-unsold nights
  totalUSD: number
  monthsWithHistory: number
}

export async function computeYearProjection(sb: Sb, propertyId: string, marketMonths: YearVsMarketMonth[]): Promise<YearProjection | null> {
  const rows = await loadYearReservations(sb, propertyId)
  if (!rows.length) return null
  const year = new Date().getFullYear()
  const today = new Date().toISOString().slice(0, 10)
  const nowMonth = new Date().getMonth() + 1 // 1..12

  // Attribute revenue per month of the current year via night proration
  const perMonthPast = new Map<number, number>()   // realized
  const perMonthFuture = new Map<number, number>() // confirmed, night >= today
  for (const r of rows) {
    const rev = r.owner_revenue ?? r.total_price ?? 0
    if (!rev || !r.nights) continue
    const perNight = await toUSD(rev / r.nights, r.currency)
    for (let m = 1; m <= 12; m++) {
      const ms = `${year}-${String(m).padStart(2, '0')}-01`
      const meExcl = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`
      const n = overlapNights(r.check_in, r.check_out, ms, meExcl)
      if (!n) continue
      // split the month's nights into past vs future relative to today
      const nPast = overlapNights(r.check_in, r.check_out, ms, today < meExcl && today > ms ? today : (meExcl <= today ? meExcl : ms))
      const past = Math.min(n, Math.max(0, nPast))
      const future = n - past
      if (past) perMonthPast.set(m, (perMonthPast.get(m) ?? 0) + perNight * past)
      if (future) perMonthFuture.set(m, (perMonthFuture.get(m) ?? 0) + perNight * future)
    }
  }

  const ytdUSD = [...perMonthPast.values()].reduce((a, b) => a + b, 0)
  const confirmedFutureUSD = [...perMonthFuture.values()].reduce((a, b) => a + b, 0)

  // Estimate still-unsold revenue for remaining months using the unit's own
  // recent full months as baseline, shaped by market seasonality.
  const mktByMonthNum = new Map<number, number>()
  for (const m of marketMonths) {
    const num = Number(m.month.slice(5, 7))
    if (typeof m.market === 'number') mktByMonthNum.set(num, m.market)
  }
  const fullMonths: number[] = []
  for (let m = nowMonth - 1; m >= 1 && fullMonths.length < 3; m--) {
    if ((perMonthPast.get(m) ?? 0) > 0) fullMonths.push(m)
  }
  let estimatedExtraUSD = 0
  const monthsWithHistory = fullMonths.length
  if (fullMonths.length >= 2) {
    const baseRev = fullMonths.reduce((s, m) => s + (perMonthPast.get(m) ?? 0), 0) / fullMonths.length
    const baseMkt = fullMonths.reduce((s, m) => s + (mktByMonthNum.get(m) ?? 0.2), 0) / fullMonths.length
    for (let m = nowMonth + 1; m <= 12; m++) {
      const shape = baseMkt > 0 ? (mktByMonthNum.get(m) ?? baseMkt) / baseMkt : 1
      const expected = baseRev * shape
      const confirmed = perMonthFuture.get(m) ?? 0
      estimatedExtraUSD += Math.max(0, expected - confirmed)
    }
    // current month remainder
    const shapeNow = baseMkt > 0 ? (mktByMonthNum.get(nowMonth) ?? baseMkt) / baseMkt : 1
    const daysIn = new Date(year, nowMonth, 0).getDate()
    const dayOfMonth = new Date().getDate()
    const remainFrac = Math.max(0, (daysIn - dayOfMonth) / daysIn)
    estimatedExtraUSD += Math.max(0, baseRev * shapeNow * remainFrac - (perMonthFuture.get(nowMonth) ?? 0))
  }

  return {
    year,
    ytdUSD: Math.round(ytdUSD),
    confirmedFutureUSD: Math.round(confirmedFutureUSD),
    estimatedExtraUSD: Math.round(estimatedExtraUSD),
    totalUSD: Math.round(ytdUSD + confirmedFutureUSD + estimatedExtraUSD),
    monthsWithHistory,
  }
}

// ── 2. Unit RevPar (trailing 90 days) ───────────────────────────────────────

export async function computeUnitRevpar90(sb: Sb, propertyId: string): Promise<number | null> {
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const { data } = await sb
    .from('reservations')
    .select('check_in, check_out, nights, total_price, owner_revenue, currency')
    .eq('property_id', propertyId)
    .in('status', ACTIVE_STATUSES)
    .eq('is_blocked', false)
    .gte('check_out', start)
    .lte('check_in', end)
  const rows = (data ?? []) as ResRow[]
  if (!rows.length) return null
  let total = 0
  for (const r of rows) {
    const rev = r.total_price ?? r.owner_revenue ?? 0
    if (!rev || !r.nights) continue
    const n = overlapNights(r.check_in, r.check_out, start, end)
    total += (await toUSD(rev / r.nights, r.currency)) * n
  }
  return Math.round(total / 90)
}

// ── 5/9. Unified activity timeline (+ milestones) ───────────────────────────

export interface TimelineEvent {
  date: string       // ISO datetime for sorting
  type: 'booking' | 'review' | 'rates'
  milestone: boolean
  title: string      // built by the page (we pass raw fields instead)
  data: any
}

export async function getTimeline(sb: Sb, propertyId: string, limit = 30): Promise<TimelineEvent[]> {
  const since = new Date(Date.now() - 90 * 86400000).toISOString()
  const [bookingsRes, reviewsRes, ratesRes] = await Promise.all([
    sb.from('reservations')
      .select('guesty_created_at, created_at, check_in, check_out, nights, total_price, owner_revenue, currency, guest_name, channel, status')
      .eq('property_id', propertyId)
      .in('status', ACTIVE_STATUSES)
      .eq('is_blocked', false)
      .order('guesty_created_at', { ascending: false })
      .limit(20),
    sb.from('reviews')
      .select('submitted_at, created_at, overall_score, guest_name, reviewer_text, channel')
      .eq('property_id', propertyId)
      .order('submitted_at', { ascending: false })
      .limit(12),
    sb.from('rate_change_events')
      .select('stay_date, old_price, new_price, detected_at')
      .eq('property_id', propertyId)
      .gte('detected_at', since)
      .order('detected_at', { ascending: false })
      .limit(200),
  ])

  const events: TimelineEvent[] = []

  for (const b of bookingsRes.data ?? []) {
    const at = b.guesty_created_at ?? b.created_at
    if (!at) continue
    const rev = b.owner_revenue ?? b.total_price ?? 0
    events.push({
      date: at,
      type: 'booking',
      milestone: true,
      title: '',
      data: {
        guest: b.guest_name, nights: b.nights, channel: b.channel,
        checkIn: b.check_in, amount: await toUSD(rev, b.currency),
      },
    })
  }
  for (const r of reviewsRes.data ?? []) {
    const at = r.submitted_at ?? r.created_at
    if (!at) continue
    events.push({
      date: at,
      type: 'review',
      milestone: (r.overall_score ?? 0) >= 4.5,
      title: '',
      data: { score: r.overall_score, guest: r.guest_name, excerpt: (r.reviewer_text ?? '').slice(0, 140) },
    })
  }
  // Group rate changes per detection day
  const byDay = new Map<string, { count: number; up: number; down: number }>()
  for (const e of ratesRes.data ?? []) {
    const day = String(e.detected_at).slice(0, 10)
    const cur = byDay.get(day) ?? { count: 0, up: 0, down: 0 }
    cur.count++
    if (e.new_price > (e.old_price ?? 0)) cur.up++
    else cur.down++
    byDay.set(day, cur)
  }
  for (const [day, agg] of byDay) {
    events.push({ date: `${day}T12:00:00Z`, type: 'rates', milestone: false, title: '', data: agg })
  }

  return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
}

// ── 7. Listing health score ─────────────────────────────────────────────────

export interface HealthScore {
  score: number // 0-100
  parts: { key: 'rating' | 'reviews' | 'photos' | 'amenities'; score: number; max: number; value: string; ok: boolean }[]
}

export function computeHealthScore(input: {
  avgRating: number | null   // portal reviews avg (1-5)
  reviewCount: number | null
  numPhotos: number | null
  amenitiesCount: number | null
}): HealthScore | null {
  const { avgRating, reviewCount, numPhotos, amenitiesCount } = input
  if (avgRating == null && reviewCount == null && numPhotos == null && amenitiesCount == null) return null
  const parts: HealthScore['parts'] = []
  // Rating: 4.9+ = 40, linear from 4.0
  const ratingScore = avgRating == null ? 20 : Math.max(0, Math.min(40, Math.round(((avgRating - 4.0) / 0.9) * 40)))
  parts.push({ key: 'rating', score: ratingScore, max: 40, value: avgRating != null ? avgRating.toFixed(2) : '—', ok: (avgRating ?? 0) >= 4.7 })
  // Reviews: 30+ = 20
  const rc = reviewCount ?? 0
  const reviewScore = Math.min(20, Math.round((rc / 30) * 20))
  parts.push({ key: 'reviews', score: reviewScore, max: 20, value: String(rc), ok: rc >= 15 })
  // Photos: 25+ = 20
  const ph = numPhotos ?? 0
  const photoScore = Math.min(20, Math.round((ph / 25) * 20))
  parts.push({ key: 'photos', score: photoScore, max: 20, value: String(ph), ok: ph >= 20 })
  // Amenities: 30+ = 20
  const am = amenitiesCount ?? 0
  const amenScore = Math.min(20, Math.round((am / 30) * 20))
  parts.push({ key: 'amenities', score: amenScore, max: 20, value: String(am), ok: am >= 25 })
  return { score: parts.reduce((s, p) => s + p.score, 0), parts }
}
