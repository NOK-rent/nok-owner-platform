/**
 * Wheelhouse RM API client (server-side only).
 * Auth: X-Integration-Api-Key (read-only RM key). Listing-scoped endpoints
 * require ?channel=guesty — our properties map via properties.guesty_listing_id.
 * All fetches use the Next data cache (revalidate) to stay far under the
 * 60 req/min limit.
 */

const BASE = process.env.WHEELHOUSE_BASE_URL || 'https://api.usewheelhouse.com/ss_api/v1'
const KEY = process.env.WHEELHOUSE_API_KEY || ''

const REVALIDATE_DATA = 60 * 60       // 1h — pricing/market data
const REVALIDATE_FX = 24 * 60 * 60    // 24h — FX rates

async function whFetch<T = any>(path: string, revalidate = REVALIDATE_DATA): Promise<T | null> {
  if (!KEY) return null
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-Integration-Api-Key': KEY },
      ...(revalidate > 0 ? { next: { revalidate } } : { cache: 'no-store' as const }),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** USD → local FX via Yahoo Finance, cached 24h. Fallbacks keep the page alive. */
async function usdRate(pair: 'DOP' | 'COP'): Promise<number> {
  const fallback = pair === 'DOP' ? 58 : 4100
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/USD${pair}=X?range=1d&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: REVALIDATE_FX } },
    )
    if (!res.ok) return fallback
    const j = await res.json()
    const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof px === 'number' && px > 0 ? px : fallback
  } catch {
    return fallback
  }
}

async function toUSD(amount: number, currency: string): Promise<number> {
  if (currency === 'USD') return amount
  if (currency === 'DOP') return amount / (await usdRate('DOP'))
  if (currency === 'COP') return amount / (await usdRate('COP'))
  return amount
}

// ── Types (shape of what the Revenue tab consumes) ──────────────────────────

export interface RateDay {
  date: string
  ours: number | null      // USD, last posted price
  zoneMedian: number | null // USD
  zoneLow: number | null
  zoneHigh: number | null
}

export interface OccWindow {
  label: string
  days: number
  unit: number | null // 0..1
  zone: number | null // 0..1
}

export interface StrategyCard {
  tag: string
  text: string
}

export interface BasePriceBreakdown {
  recommended: number
  conservative: number
  aggressive: number
  selected: number
  anchorCredibility: number | null
  attribution: { label: string; value: number }[]
}

export interface SeasonRange {
  name: string
  start: string // ISO
  end: string   // ISO
}

export interface MarketPosition {
  percentile: number          // 0-100: % of the market the unit is above
  occupancy: number           // our month occupancy 0..1
  monthISO: string            // first day of the month measured
  histogram: { min: number; max: number; probability: number }[]
}

export interface RevenueSnapshot {
  tierName: string | null
  horizonDays: number | null
  todayPrice: number | null
  pickup7: number | null
  zoneListings: number | null
  posVsZonePct: number | null // negative = below zone median
  rateDays: RateDay[]
  occWindows: OccWindow[]
  strategy: StrategyCard[]
  flags: { name: string; description: string }[]
  autoPosting: boolean
  // ── deep insights ──
  basePrice: BasePriceBreakdown | null
  basePriceAdjustmentPct: number | null // e.g. -10 = publishing 10% below recommendation
  demandSensitivityPct: number | null
  pacingAdjusted: boolean
  historicalAnchoringPct: number | null
  upcomingSeasons: SeasonRange[]
  revenueScore30: number | null   // 0-100
  occRatio30: number | null       // unit occupancy / zone occupancy
  bookings30: number | null
  zoneOccDaily: { date: string; occ: number }[] // 0..1, next 90 days
  marketPosition: MarketPosition | null
}

// ── Humanizers ──────────────────────────────────────────────────────────────

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function humanizeMinStays(rules: any[]): string {
  if (!Array.isArray(rules) || rules.length === 0) return 'Sin mínimo de noches configurado.'
  const global = rules.find(r => r.type === 'global')
  const timeBased = rules
    .filter(r => r.type === 'time_based' && typeof r.value === 'number')
    .sort((a, b) => (a.days_after ?? 0) - (b.days_after ?? 0))
  const parts: string[] = []
  if (global) parts.push(`${global.value} noches en general`)
  for (const r of timeBased) {
    if (r.days_before != null) parts.push(`${r.value} noches para fechas dentro de ${r.days_before} días`)
    else if (r.days_after != null) parts.push(`${r.value} noches a partir de ${r.days_after} días`)
  }
  return parts.length ? `Mínimo de ${parts.join(' · ')}. Más flexibilidad cerca de la fecha para capturar reservas de último minuto.` : 'Sin mínimo de noches configurado.'
}

function humanizeFloors(rules: any[]): string {
  if (!Array.isArray(rules) || rules.length === 0) return 'Sin pisos de precio configurados.'
  const global = rules.find(r => r.type === 'global')
  const special = rules.filter(r => r.type === 'event' || r.type === 'seasonal' || r.type === 'monthly')
  const specialMax = special.length ? Math.max(...special.map(r => r.value).filter((v: any) => typeof v === 'number')) : null
  let text = global ? `Tu tarifa nunca baja de ${fmtUsd(global.value)} por noche` : 'Pisos de precio activos'
  if (special.length) {
    text += `, con ${special.length} piso${special.length > 1 ? 's' : ''} especial${special.length > 1 ? 'es' : ''} para eventos y temporada alta${specialMax ? ` (hasta ${fmtUsd(specialMax)})` : ''}`
  }
  return text + '.'
}

function humanizeSeasonality(adj: any): string {
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  if (adj?.type === 'CUS' && Array.isArray(adj.rules) && adj.rules.length) {
    const monthly = adj.rules.filter((r: any) => r.type === 'monthly' && Array.isArray(r.months) && typeof r.value === 'number')
    if (monthly.length >= 2) {
      const peak = monthly.reduce((a: any, b: any) => (a.value >= b.value ? a : b))
      const low = monthly.reduce((a: any, b: any) => (a.value <= b.value ? a : b))
      const peakPct = Math.round((peak.value - 1) * 100)
      const lowPct = Math.round((low.value - 1) * 100)
      const lowTxt = lowPct === 0 ? 'sin ajuste' : `${lowPct}%`
      return `Curva propia calibrada a tu mercado: pico en ${MESES[peak.months[0] - 1]} (${peakPct >= 0 ? '+' : ''}${peakPct}%) y valle en ${MESES[low.months[0] - 1]} (${lowTxt}).`
    }
  }
  return 'Seguimos la curva de temporada recomendada por el mercado, ajustada automáticamente cada día.'
}

const LM_LABEL: Record<string, string> = {
  AGG: 'agresivos para rescatar noches que quedarían vacías',
  MOD: 'moderados',
  CON: 'conservadores para proteger la tarifa',
  REC: 'según lo recomendado por el mercado',
}

/** base_price_attribution keys → owner-friendly Spanish */
const ATTR_ES: Record<string, string> = {
  market_baseline: 'Punto de partida del mercado',
  bedrooms_bathrooms: 'Habitaciones y baños',
  room_type: 'Tipo de propiedad',
  guests: 'Capacidad de huéspedes',
  location: 'Ubicación exacta',
  amenities_fees: 'Amenidades y fees',
  occupancy: 'Ocupación reciente',
  observed_bookings: 'Historial de reservas',
}

/** Next occurrence of a yearly date range (shift years until it hasn't ended). */
function nextYearlyOccurrence(start: string, end: string, today: string): { start: string; end: string } | null {
  const shift = (iso: string, years: number) => {
    const [y, m, d] = iso.split('-').map(Number)
    return `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  for (let k = 0; k <= 3; k++) {
    const e = shift(end, k)
    if (e >= today) return { start: shift(start, k), end: e }
  }
  return null
}

// ── Main loader ─────────────────────────────────────────────────────────────

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export type WheelhouseChannel = 'guesty' | 'airbnb'

/**
 * Resolve the Wheelhouse listing reference for a property row.
 * Priority: properties.wheelhouse_property_id (optionally "channel:id" for
 * non-guesty channels) → properties.guesty_listing_id (channel guesty).
 */
export function resolveWheelhouseRef(property: { wheelhouse_property_id?: string | null; guesty_listing_id?: string | null }): { id: string; channel: WheelhouseChannel } | null {
  const override = property.wheelhouse_property_id?.trim()
  if (override) {
    const [maybeChannel, rest] = override.includes(':') ? override.split(':', 2) : [null, override]
    if (maybeChannel === 'airbnb' || maybeChannel === 'guesty') return { id: rest, channel: maybeChannel }
    return { id: override, channel: 'guesty' }
  }
  if (property.guesty_listing_id) return { id: property.guesty_listing_id, channel: 'guesty' }
  return null
}

export async function getRevenueSnapshot(guestyListingId: string, channel: WheelhouseChannel = 'guesty'): Promise<RevenueSnapshot | null> {
  const q = `channel=${channel}`
  const start = isoDaysFromNow(0)
  const end = isoDaysFromNow(90)

  const [tier, kpis, prefs, lastPosted, nbPricing, nbOcc, flags, baseRec, listing, kpisMonthly] = await Promise.all([
    whFetch<{ name: string; horizon: number }>(`/listings/${guestyListingId}/pricing_tier?${q}`),
    whFetch<any>(`/listings/${guestyListingId}/kpis?${q}`),
    whFetch<any>(`/preferences/${guestyListingId}?${q}`),
    whFetch<any[]>(`/listings/${guestyListingId}/last_posted_prices?${q}`),
    whFetch<{ data: any[]; currency: string }>(`/listings/${guestyListingId}/neighborhood/pricing?${q}&start_date=${start}&end_date=${end}`),
    whFetch<{ data: any[] }>(`/listings/${guestyListingId}/neighborhood/occupancy?${q}&start_date=${start}&end_date=${end}`),
    whFetch<{ name: string; description: string }[]>(`/listings/${guestyListingId}/flags?${q}`),
    whFetch<any>(`/listings/${guestyListingId}/base_price_recommendation?${q}`),
    whFetch<any>(`/listings/${guestyListingId}?${q}`),
    whFetch<any>(`/listings/${guestyListingId}/kpis/monthly?${q}`),
  ])

  // If the core listing data is missing, the property isn't in Wheelhouse (or API down)
  if (!prefs && !kpis) return null

  const postedByDate = new Map<string, number>(
    (lastPosted ?? []).map((r: any) => [r.stay_date, r.last_posted_price]),
  )

  const nbCurrency = nbPricing?.currency ?? 'USD'
  const nbRate = nbCurrency === 'USD' ? 1 : (await toUSD(1, nbCurrency))

  const rateDays: RateDay[] = (nbPricing?.data ?? []).slice(0, 90).map((d: any) => ({
    date: d.stay_date,
    ours: postedByDate.get(d.stay_date) ?? null,
    zoneMedian: d.median_price != null ? d.median_price * nbRate : null,
    zoneLow: d.low_price != null ? d.low_price * nbRate : null,
    zoneHigh: d.high_price != null ? d.high_price * nbRate : null,
  }))

  // Position vs zone: mean over next 30 days where both sides exist
  const cmp = rateDays.slice(0, 30).filter(d => d.ours != null && d.zoneMedian != null)
  const posVsZonePct = cmp.length >= 5
    ? Math.round(
        ((cmp.reduce((s, d) => s + (d.ours as number), 0) / cmp.length) /
          (cmp.reduce((s, d) => s + (d.zoneMedian as number), 0) / cmp.length) - 1) * 100,
      )
    : null

  // Occupancy windows: unit (kpis fwd) vs zone (mean of adjusted daily occupancy)
  const occDaily: number[] = (nbOcc?.data ?? []).map((d: any) => d.adjusted_occupancy ?? d.occupancy).filter((v: any) => typeof v === 'number')
  const zoneMean = (days: number) => {
    const sub = occDaily.slice(0, days)
    return sub.length ? sub.reduce((a, b) => a + b, 0) / sub.length : null
  }
  const unitOcc = (w: string) => {
    const v = kpis?.occupancy?.[w]
    return typeof v === 'number' ? v : null
  }
  const occWindows: OccWindow[] = [
    { label: 'Próximos 7 días', days: 7, unit: unitOcc('0_7'), zone: zoneMean(7) },
    { label: 'Próximos 30 días', days: 30, unit: unitOcc('0_30'), zone: zoneMean(30) },
    { label: 'Próximos 60 días', days: 60, unit: unitOcc('0_60'), zone: zoneMean(60) },
    { label: 'Próximos 90 días', days: 90, unit: unitOcc('0_90'), zone: zoneMean(90) },
  ]

  // Strategy cards (humanized preferences)
  const strategy: StrategyCard[] = []
  const horizon = tier?.horizon ?? null
  strategy.push({
    tag: 'Precio dinámico',
    text: `La tarifa se recalcula todos los días${horizon ? ` para los próximos ${horizon} días` : ''} según demanda, eventos y ritmo de reservas de la zona, y se publica automáticamente en los canales.`,
  })
  if (typeof prefs?.base_price_adjustment === 'number' && prefs.base_price_adjustment !== 1) {
    const pct = Math.round((prefs.base_price_adjustment - 1) * 100)
    strategy.push({
      tag: 'Posicionamiento',
      text: pct < 0
        ? `Publicamos ${Math.abs(pct)}% por debajo de la recomendación base para priorizar ocupación y ritmo de reservas.`
        : `Publicamos ${pct}% por encima de la recomendación base para priorizar tarifa por noche.`,
    })
  } else {
    strategy.push({ tag: 'Posicionamiento', text: 'Publicamos la tarifa recomendada por el motor, sin ajustes manuales.' })
  }
  strategy.push({ tag: 'Pisos de precio', text: humanizeFloors(prefs?.minimum_price_rules_v3 ?? []) })
  strategy.push({ tag: 'Estancia mínima', text: humanizeMinStays(prefs?.minimum_stay_rules_v3 ?? []) })
  if (prefs?.weekly_discount || prefs?.monthly_discount) {
    strategy.push({
      tag: 'Estancias largas',
      text: `Descuento de ${prefs.weekly_discount ?? 0}% por semana y ${prefs.monthly_discount ?? 0}% por mes para atraer estancias largas que reducen rotación.`,
    })
  }
  const lmType = prefs?.last_minute_discount?.type
  if (lmType && LM_LABEL[lmType]) {
    strategy.push({ tag: 'Último minuto', text: `Descuentos de último minuto ${LM_LABEL[lmType]}.` })
  }
  strategy.push({ tag: 'Temporada', text: humanizeSeasonality(prefs?.seasonality_adjustment) })

  const today = isoDaysFromNow(0)

  // ── Deep insights ──
  const basePrice: BasePriceBreakdown | null = baseRec && typeof baseRec.base_price_recommended === 'number'
    ? {
        recommended: baseRec.base_price_recommended,
        conservative: baseRec.base_price_conservative,
        aggressive: baseRec.base_price_aggressive,
        selected: baseRec.base_price_selected,
        anchorCredibility: typeof baseRec.anchor_credibility === 'number' ? Math.round(baseRec.anchor_credibility) : null,
        attribution: Object.entries(baseRec.base_price_attribution ?? {})
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => ({ label: ATTR_ES[k] ?? k, value: v as number })),
      }
    : null

  const globalRule = (rules: any) =>
    Array.isArray(rules) ? rules.find((r: any) => r.type === 'global')?.value : undefined
  const demandVal = globalRule(prefs?.demand_sensitivity_rules)
  const anchorVal = globalRule(prefs?.historical_anchoring_rules)

  const upcomingSeasons: SeasonRange[] = (prefs?.custom_date_ranges ?? [])
    .flatMap((r: any) => {
      if (!r?.name || !Array.isArray(r.date_ranges)) return []
      return r.date_ranges
        .map((dr: any) => (r.yearly ? nextYearlyOccurrence(dr.start_date, dr.end_date, today) : (dr.end_date >= today ? { start: dr.start_date, end: dr.end_date } : null)))
        .filter(Boolean)
        .map((dr: any) => ({ name: String(r.name).trim(), start: dr.start, end: dr.end }))
    })
    .sort((a: SeasonRange, b: SeasonRange) => a.start.localeCompare(b.start))
    .filter((s: SeasonRange, i: number, arr: SeasonRange[]) =>
      arr.findIndex(x => x.name === s.name || (x.start === s.start && x.end === s.end)) === i)
    .slice(0, 4)

  const occRatio30 =
    typeof kpis?.occupancy_adjusted?.['0_30'] === 'number' && typeof kpis?.occupancy_neighborhood_adjusted?.['0_30'] === 'number' && kpis.occupancy_neighborhood_adjusted['0_30'] > 0
      ? kpis.occupancy_adjusted['0_30'] / kpis.occupancy_neighborhood_adjusted['0_30']
      : null

  const zoneOccDaily = (nbOcc?.data ?? []).slice(0, 90).map((d: any) => ({
    date: d.stay_date as string,
    occ: (typeof d.adjusted_occupancy === 'number' ? d.adjusted_occupancy : d.occupancy) as number,
  })).filter((d: any) => typeof d.occ === 'number')

  // ── Market position: where this unit sits in its market's occupancy distribution ──
  let marketPosition: MarketPosition | null = null
  const marketId = listing?.market_id
  const monthISO = `${today.slice(0, 7)}-01`
  const myMonthOcc = (kpisMonthly?.data ?? []).find((m: any) => (m.month ?? '').startsWith(today.slice(0, 7)))?.occupancy_adjusted
  if (typeof marketId === 'number' && typeof myMonthOcc === 'number') {
    const beds = typeof listing?.num_bedrooms === 'number' ? (listing.num_bedrooms >= 4 ? '4%2B' : String(listing.num_bedrooms)) : null
    const dist = await whFetch<any>(`/market_report/${marketId}/distribution?metric=occupancy_adjusted&month=${monthISO}${beds ? `&bedrooms=${beds}` : ''}`)
    const buckets = dist?.data?.occupancy_adjusted
    if (Array.isArray(buckets) && buckets.length) {
      let pct: number | null = null
      for (const b of buckets) {
        if (myMonthOcc >= b.bucket_min_incl && myMonthOcc < b.bucket_max_excl) {
          const before = b.percentile - b.probability
          const frac = (myMonthOcc - b.bucket_min_incl) / (b.bucket_max_excl - b.bucket_min_incl || 1)
          pct = (before + b.probability * frac) * 100
          break
        }
      }
      if (pct == null && myMonthOcc >= buckets[buckets.length - 1].bucket_max_excl) pct = 100
      if (pct != null) {
        marketPosition = {
          percentile: Math.round(pct),
          occupancy: myMonthOcc,
          monthISO,
          histogram: buckets.map((b: any) => ({ min: b.bucket_min_incl, max: b.bucket_max_excl, probability: b.probability })),
        }
      }
    }
  }

  return {
    tierName: tier?.name ?? null,
    horizonDays: horizon,
    todayPrice: postedByDate.get(today) ?? null,
    pickup7: typeof kpis?.pickup?.['7_0'] === 'number' ? kpis.pickup['7_0'] : null,
    zoneListings: nbPricing?.data?.[0]?.listings_count ?? null,
    posVsZonePct,
    rateDays,
    occWindows,
    strategy,
    flags: Array.isArray(flags) ? flags : [],
    autoPosting: prefs?.automatic_rate_posting_enabled !== false,
    basePrice,
    demandSensitivityPct: typeof demandVal === 'number' ? demandVal : null,
    pacingAdjusted: prefs?.occupancy_pacing?.adjusted === true,
    historicalAnchoringPct: typeof anchorVal === 'number' ? anchorVal : null,
    upcomingSeasons,
    revenueScore30: typeof kpis?.revenue_score?.['0_30'] === 'number' ? kpis.revenue_score['0_30'] : null,
    occRatio30,
    bookings30: typeof kpis?.bookings?.['0_30'] === 'number' ? kpis.bookings['0_30'] : null,
    zoneOccDaily,
    marketPosition,
    basePriceAdjustmentPct: typeof prefs?.base_price_adjustment === 'number'
      ? Math.round((prefs.base_price_adjustment - 1) * 100)
      : null,
  }
}

// ── Extras for the Strategy tab & rate-change tracking ──────────────────────

export interface BasePriceHistoryPoint {
  date: string        // model_date
  recommended: number // engine recommendation before our adjustment
  applied: number     // effective base price actually used
}

/** Evolution of the engine's base price recommendation vs. what we applied. */
export async function getBasePriceHistory(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<BasePriceHistoryPoint[]> {
  const rows = await whFetch<any[]>(`/listings/${listingId}/base_price_history?channel=${channel}`)
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => typeof r?.recommendation === 'number' && typeof r?.effective_base_price === 'number' && r?.model_date)
    .map(r => ({ date: r.model_date as string, recommended: r.recommendation as number, applied: Math.round(r.effective_base_price) }))
}

/** How many times the engine published prices in the last N days (activity signal). */
export async function getPostingCount(listingId: string, channel: WheelhouseChannel = 'guesty', days = 7): Promise<number | null> {
  const log = await whFetch<{ events: { time: string; event: string }[] }>(`/preferences/${listingId}/changelog?channel=${channel}`)
  if (!Array.isArray(log?.events)) return null
  const cutoff = new Date(Date.now() - days * 86400000).toISOString()
  return log.events.filter(e => e.event === 'Prices posted' && e.time >= cutoff).length
}

/** Fresh (uncached) map of stay_date → last posted price. Used by the rate-watch cron. */
export async function getLastPostedMap(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<Record<string, number> | null> {
  const rows = await whFetch<any[]>(`/listings/${listingId}/last_posted_prices?channel=${channel}`, 0)
  if (!Array.isArray(rows)) return null
  const map: Record<string, number> = {}
  for (const r of rows) {
    if (r?.stay_date && typeof r?.last_posted_price === 'number') map[r.stay_date] = r.last_posted_price
  }
  return map
}

// ── Year vs market, seasonality curve, lead time, what-if preview ───────────

export interface YearVsMarketMonth {
  month: string          // YYYY-MM
  unit: number | null    // occupancy_adjusted 0..1
  market: number | null  // occupancy_adjusted 0..1
}

async function listingMeta(listingId: string, channel: WheelhouseChannel) {
  const listing = await whFetch<any>(`/listings/${listingId}?channel=${channel}`)
  const marketId = typeof listing?.market_id === 'number' ? listing.market_id : null
  const beds = typeof listing?.num_bedrooms === 'number' ? (listing.num_bedrooms >= 4 ? '4%2B' : String(listing.num_bedrooms)) : null
  return { marketId, beds }
}

/** Trailing 12 months: unit occupancy vs market occupancy (same bedroom count). */
export async function getYearVsMarket(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<YearVsMarketMonth[]> {
  const { marketId, beds } = await listingMeta(listingId, channel)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const startISO = start.toISOString().slice(0, 10)
  const endISO = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)

  const [monthly, ts] = await Promise.all([
    whFetch<any>(`/listings/${listingId}/kpis/monthly?channel=${channel}`),
    marketId != null
      ? whFetch<any>(`/market_report/${marketId}/time_series?metrics=occupancy_adjusted&start_date=${startISO}&end_date=${endISO}${beds ? `&bedrooms=${beds}` : ''}`)
      : Promise.resolve(null),
  ])

  const unitByMonth = new Map<string, number>()
  for (const m of monthly?.data ?? []) {
    const key = (m.month ?? '').slice(0, 7)
    if (typeof m.occupancy_adjusted === 'number') unitByMonth.set(key, m.occupancy_adjusted)
  }
  const mktAgg = new Map<string, { sum: number; n: number }>()
  for (const d of ts?.data ?? []) {
    const key = (d.stay_date ?? '').slice(0, 7)
    if (typeof d.occupancy_adjusted === 'number') {
      const cur = mktAgg.get(key) ?? { sum: 0, n: 0 }
      cur.sum += d.occupancy_adjusted; cur.n++
      mktAgg.set(key, cur)
    }
  }

  const out: YearVsMarketMonth[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const mkt = mktAgg.get(key)
    out.push({ month: key, unit: unitByMonth.get(key) ?? null, market: mkt ? mkt.sum / mkt.n : null })
  }
  // Months before the unit's first activity report 0% — that's pre-onboarding,
  // not underperformance. Hide the unit bar for that leading stretch.
  for (const m of out) {
    if (m.unit === 0) m.unit = null
    else if (m.unit != null && m.unit > 0) break
  }
  return out
}

/** The unit's applied 12-month seasonality curve (custom if set, else recommended). */
export async function getSeasonalityCurve(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<{ month: number; factor: number }[]> {
  const prefs = await whFetch<any>(`/preferences/${listingId}?channel=${channel}`)
  const adj = prefs?.seasonality_adjustment
  if (adj?.type === 'CUS' && Array.isArray(adj.rules)) {
    const monthly = adj.rules.filter((r: any) => r.type === 'monthly' && Array.isArray(r.months) && typeof r.value === 'number')
    if (monthly.length >= 6) {
      return monthly
        .map((r: any) => ({ month: r.months[0] as number, factor: r.value as number }))
        .sort((a: any, b: any) => a.month - b.month)
    }
  }
  const rec = await whFetch<any>(`/listings/${listingId}/monthly_seasonality?channel=${channel}`)
  const curve = rec?.REC ?? rec?.CON
  if (curve && typeof curve === 'object') {
    return Object.entries(curve)
      .map(([m, f]) => ({ month: Number(m), factor: f as number }))
      .filter(x => x.month >= 1 && x.month <= 12 && typeof x.factor === 'number')
      .sort((a, b) => a.month - b.month)
  }
  return []
}

/** Median booking anticipation (days) in the unit's market, last 90 days. */
export async function getMarketLeadTime(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<number | null> {
  const { marketId, beds } = await listingMeta(listingId, channel)
  if (marketId == null) return null
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const ts = await whFetch<any>(`/market_report/${marketId}/time_series?metrics=lead_time&start_date=${start}&end_date=${end}${beds ? `&bedrooms=${beds}` : ''}`)
  const vals = (ts?.data ?? []).map((d: any) => d.lead_time).filter((v: any) => typeof v === 'number').map((v: number) => Math.abs(v)).sort((a: number, b: number) => a - b)
  if (!vals.length) return null
  return Math.round(vals[Math.floor(vals.length / 2)])
}

/** What-if: preview price recommendations under a different positioning. */
export async function previewPositioning(listingId: string, channel: WheelhouseChannel, adjustmentPct: number): Promise<{
  days: { date: string; current: number; simulated: number }[]
  avgCurrent: number
  avgSimulated: number
} | null> {
  if (!KEY) return null
  const adjustment = 1 + adjustmentPct / 100
  try {
    const [curRes, simRes] = await Promise.all([
      fetch(`${BASE}/listings/${listingId}/price_recommendations?channel=${channel}`, {
        headers: { 'X-Integration-Api-Key': KEY }, next: { revalidate: 60 * 60 },
      }),
      fetch(`${BASE}/preferences/${listingId}/preview?channel=${channel}`, {
        method: 'POST',
        headers: { 'X-Integration-Api-Key': KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_price_adjustment: Math.round(adjustment * 100) / 100 }),
        cache: 'no-store',
      }),
    ])
    if (!curRes.ok || !simRes.ok) return null
    const cur = await curRes.json()
    const sim = await simRes.json()
    const simByDate = new Map<string, number>((sim?.data ?? []).map((r: any) => [r.stay_date, r.price]))
    const days = (cur?.data ?? [])
      .slice(0, 90)
      .filter((r: any) => typeof r.price === 'number' && typeof simByDate.get(r.stay_date) === 'number')
      .map((r: any) => ({ date: r.stay_date as string, current: r.price as number, simulated: simByDate.get(r.stay_date) as number }))
    if (days.length < 7) return null
    const avg = (k: 'current' | 'simulated') => Math.round(days.reduce((s: number, d: any) => s + d[k], 0) / days.length)
    return { days, avgCurrent: avg('current'), avgSimulated: avg('simulated') }
  } catch {
    return null
  }
}

// ── FX export, market RevPar, listing quality ───────────────────────────────

/** Convert an amount in DOP/COP/USD to USD (daily rate, cached 24h). */
export async function fxToUSD(amount: number, currency: string): Promise<number> {
  return toUSD(amount, currency)
}

/** Market RevPar (with fees) over the trailing 90 days, in USD. */
export async function getMarketRevpar90(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<number | null> {
  const { marketId, beds } = await listingMeta(listingId, channel)
  if (marketId == null) return null
  const end = new Date().toISOString().slice(0, 10)
  const start = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const ts = await whFetch<any>(`/market_report/${marketId}/time_series?metrics=revpar_w_fees&start_date=${start}&end_date=${end}${beds ? `&bedrooms=${beds}` : ''}`)
  const vals = (ts?.data ?? []).map((d: any) => d.revpar_w_fees).filter((v: any) => typeof v === 'number')
  if (!vals.length) return null
  const mean = vals.reduce((a: number, b: number) => a + b, 0) / vals.length
  return await toUSD(mean, ts?.currency ?? 'USD')
}

export interface ListingQuality {
  numPhotos: number | null
  numReviews: number | null
  starRating: number | null
  amenitiesCount: number | null
}

/** Listing quality raw signals from the channel listing. */
export async function getListingQuality(listingId: string, channel: WheelhouseChannel = 'guesty'): Promise<ListingQuality | null> {
  const l = await whFetch<any>(`/listings/${listingId}?channel=${channel}`)
  if (!l) return null
  return {
    numPhotos: typeof l.num_photos === 'number' ? l.num_photos : null,
    numReviews: typeof l.num_reviews === 'number' ? l.num_reviews : null,
    starRating: typeof l.star_rating === 'number' ? l.star_rating : null,
    amenitiesCount: Array.isArray(l.amenities) ? l.amenities.length : null,
  }
}
