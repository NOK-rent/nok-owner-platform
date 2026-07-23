/**
 * Wheelhouse RM API client (server-side only).
 * Auth: X-Integration-Api-Key (read-only RM key). Listing-scoped endpoints
 * require ?channel=guesty — our properties map via properties.guesty_listing_id.
 * All fetches use the Next data cache (revalidate) to stay far under the
 * 60 req/min limit.
 */

const BASE = process.env.WHEELHOUSE_BASE_URL || 'https://api.usewheelhouse.com/ss_api/v1'
const KEY = process.env.WHEELHOUSE_API_KEY || ''

const REVALIDATE_DATA = 6 * 60 * 60   // 6h — pricing/market data
const REVALIDATE_FX = 24 * 60 * 60    // 24h — FX rates

async function whFetch<T = any>(path: string, revalidate = REVALIDATE_DATA): Promise<T | null> {
  if (!KEY) return null
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { 'X-Integration-Api-Key': KEY },
      next: { revalidate },
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

// ── Main loader ─────────────────────────────────────────────────────────────

function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function getRevenueSnapshot(guestyListingId: string): Promise<RevenueSnapshot | null> {
  const q = `channel=guesty`
  const start = isoDaysFromNow(0)
  const end = isoDaysFromNow(90)

  const [tier, kpis, prefs, lastPosted, nbPricing, nbOcc, flags] = await Promise.all([
    whFetch<{ name: string; horizon: number }>(`/listings/${guestyListingId}/pricing_tier?${q}`),
    whFetch<any>(`/listings/${guestyListingId}/kpis?${q}`),
    whFetch<any>(`/preferences/${guestyListingId}?${q}`),
    whFetch<any[]>(`/listings/${guestyListingId}/last_posted_prices?${q}`),
    whFetch<{ data: any[]; currency: string }>(`/listings/${guestyListingId}/neighborhood/pricing?${q}&start_date=${start}&end_date=${end}`),
    whFetch<{ data: any[] }>(`/listings/${guestyListingId}/neighborhood/occupancy?${q}&start_date=${start}&end_date=${end}`),
    whFetch<{ name: string; description: string }[]>(`/listings/${guestyListingId}/flags?${q}`),
  ])

  // If the core listing data is missing, the property isn't in Wheelhouse (or API down)
  if (!prefs && !kpis) return null

  const postedByDate = new Map<string, number>(
    (lastPosted ?? []).map((r: any) => [r.stay_date, r.last_posted_price]),
  )

  const nbCurrency = nbPricing?.currency ?? 'USD'
  const nbRate = nbCurrency === 'USD' ? 1 : (await toUSD(1, nbCurrency))

  const rateDays: RateDay[] = (nbPricing?.data ?? []).slice(0, 60).map((d: any) => ({
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
  }
}
