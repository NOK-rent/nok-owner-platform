import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import {
  getRevenueSnapshot, resolveWheelhouseRef, getBasePriceHistory, getPostingCount,
  type OccWindow, type BasePriceBreakdown, type SeasonRange, type MarketPosition, type BasePriceHistoryPoint,
} from '@/lib/wheelhouse'
import { getLocale } from '@/lib/i18n'
import { snapshotToEnglish, FLAG_EN } from '@/lib/strategy-i18n'
import { RateChartInteractive, OccDailyChartInteractive } from '@/components/dashboard/StrategyCharts'

interface Props {
  params: Promise<{ propertyId: string }>
}

export const revalidate = 0 // page is per-user (auth); data cache lives at the fetch layer

function fmtUsd(n: number | null) {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function fmtPct01(v: number | null) {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// Idioma del render actual (server component — se setea al inicio de la página)
let EN = false
function fmtDay(iso: string) {
  const [, m, d] = iso.split('-')
  return EN ? `${MONTHS_SHORT[+m - 1]} ${+d}` : `${+d} ${MESES_CORTOS[+m - 1]}`
}

/** Known Wheelhouse flags → owner-friendly Spanish */
const FLAG_ES: Record<string, { title: string; text: string }> = {
  'High Availability': {
    title: 'Alta disponibilidad',
    text: 'Buena parte de los próximos 60 días está libre. La estrategia entra en modo ocupación: posicionamiento competitivo y descuentos de último minuto activos hasta recuperar ritmo.',
  },
  'Base Price - High Historical Impact': {
    title: 'El historial está pesando en el precio base',
    text: 'La recomendación de precio base se ajustó según el ritmo real de reservas de tu unidad. El motor aprende del comportamiento propio, no solo del mercado.',
  },
  'Low Availability': {
    title: 'Poca disponibilidad',
    text: 'La mayoría de las próximas fechas ya está reservada — el motor sube tarifas para maximizar el valor de las noches restantes.',
  },
}

// ── Server-rendered SVG: market occupancy histogram with our marker ─────────

function MarketHistogram({ mp }: { mp: MarketPosition }) {
  const W = 420, H = 150, P = { t: 10, r: 8, b: 22, l: 8 }
  const buckets = mp.histogram
  if (!buckets.length) return null
  const maxP = Math.max(...buckets.map(b => b.probability), 0.01)
  const bw = (W - P.l - P.r) / buckets.length
  const x = (i: number) => P.l + i * bw
  const h = (p: number) => Math.max(2, ((H - P.t - P.b) * p) / maxP)
  const ourI = buckets.findIndex(b => mp.occupancy >= b.min && mp.occupancy < b.max)
  const markerX = ourI >= 0 ? x(ourI) + bw / 2 : W - P.r

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Distribución de ocupación del mercado con la posición de tu unidad">
      {buckets.map((b, i) => (
        <rect
          key={b.min}
          x={x(i) + 1}
          y={H - P.b - h(b.probability)}
          width={Math.max(2, bw - 2)}
          height={h(b.probability)}
          rx={2}
          fill={i === ourI ? '#0E6845' : 'rgba(0,128,198,0.35)'}
        />
      ))}
      <line x1={markerX} x2={markerX} y1={P.t} y2={H - P.b} stroke="#0E6845" strokeWidth={2} strokeDasharray="4 3" />
      <text x={P.l} y={H - 6} fontSize={10} fill="rgba(26,26,26,0.35)">0%</text>
      <text x={W - P.r} y={H - 6} textAnchor="end" fontSize={10} fill="rgba(26,26,26,0.35)">100%</text>
    </svg>
  )
}

// ── Server-rendered SVG: base price recommendation vs applied over time ─────

function BaseHistoryChart({ points }: { points: BasePriceHistoryPoint[] }) {
  const pts = points.slice(-60)
  if (pts.length < 5) return null
  const W = 420, H = 170, P = { t: 10, r: 10, b: 22, l: 40 }
  const ys = pts.flatMap(p => [p.recommended, p.applied])
  const yMin = Math.floor(Math.min(...ys) / 10) * 10
  const yMax = Math.ceil(Math.max(...ys) / 10) * 10
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - yMin) / (yMax - yMin || 1))
  const line = (key: 'recommended' | 'applied') =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Evolución del precio base recomendado y aplicado">
      {[yMin, (yMin + yMax) / 2, yMax].map(v => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(26,26,26,0.07)" strokeWidth={1} />
          <text x={P.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="rgba(26,26,26,0.35)">${Math.round(v)}</text>
        </g>
      ))}
      {[0, Math.floor(pts.length / 2), pts.length - 1].map(i => (
        <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} fontSize={10} fill="rgba(26,26,26,0.35)">{fmtDay(pts[i].date)}</text>
      ))}
      <path d={line('recommended')} fill="none" stroke="#0080C6" strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" />
      <path d={line('applied')} fill="none" stroke="#0E6845" strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
  )
}

/** Waterfall-style breakdown of the recommended base price */
function BaseBreakdown({ bp }: { bp: BasePriceBreakdown }) {
  const items = bp.attribution
  const maxAbs = Math.max(...items.map(i => Math.abs(i.value)), 1)
  return (
    <div className="space-y-2.5">
      {items.map(it => {
        const isBase = it.label === 'Punto de partida del mercado'
        const pos = it.value >= 0
        const w = Math.max(3, Math.round((Math.abs(it.value) / maxAbs) * 100))
        return (
          <div key={it.label} className="grid items-center gap-3" style={{ gridTemplateColumns: '170px 1fr 64px' }}>
            <span className="text-xs" style={{ color: 'rgba(26,26,26,0.5)' }}>{it.label}</span>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(26,26,26,0.05)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${w}%`,
                  backgroundColor: isBase ? '#B9B5DC' : pos ? '#0E6845' : 'rgba(220,38,38,0.8)',
                }}
              />
            </div>
            <span className="text-xs text-right tabular-nums" style={{ color: isBase ? '#B9B5DC' : pos ? '#0E6845' : '#DC2626' }}>
              {isBase ? '' : it.value >= 0 ? '+' : '−'}${Math.abs(Math.round(it.value))}
            </span>
          </div>
        )
      })}
    </div>
  )
}

const MESES_LARGOS = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
function fmtRange(s: SeasonRange) {
  const f = (iso: string) => {
    const [, m, d] = iso.split('-')
    return EN ? `${MONTHS_SHORT[+m - 1]} ${+d}` : `${+d} ${MESES_LARGOS[+m - 1].slice(0, 3)}`
  }
  return `${f(s.start)} – ${f(s.end)}`
}

function OccCompare({ windows }: { windows: OccWindow[] }) {
  return (
    <div className="space-y-4">
      {windows.map(w => (
        <div key={w.label}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span style={{ color: 'rgba(26,26,26,0.45)' }}>{w.label}</span>
            <span style={{ color: 'rgba(26,26,26,0.65)' }}>
              {EN ? 'Your unit' : 'Tu unidad'} {fmtPct01(w.unit)} · {EN ? 'Area' : 'Zona'} {fmtPct01(w.zone)}
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((w.unit ?? 0) * 100))}%`, backgroundColor: '#0E6845' }} />
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((w.zone ?? 0) * 100))}%`, backgroundColor: '#0080C6' }} />
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-5 pt-1 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#0E6845' }} /> {EN ? 'Your unit' : 'Tu unidad'}</span>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#0080C6' }} /> {EN ? 'Area' : 'Zona'}</span>
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl p-5 nok-card">
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(26,26,26,0.35)' }}>{label}</p>
      <p className="font-serif text-4xl font-light text-[#1A1A1A] leading-none">{value}</p>
      {sub && <p className="text-xs mt-2" style={{ color: 'rgba(26,26,26,0.3)' }}>{sub}</p>}
    </div>
  )
}

export default async function RevenuePage({ params }: Props) {
  const { propertyId } = await params
  const { property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const locale = await getLocale()
  EN = locale === 'en'

  const whRef = resolveWheelhouseRef(property)
  const [snapEs, baseHistory, postingCount7d] = whRef
    ? await Promise.all([
        getRevenueSnapshot(whRef.id, whRef.channel),
        getBasePriceHistory(whRef.id, whRef.channel),
        getPostingCount(whRef.id, whRef.channel, 7),
      ])
    : [null, [] as BasePriceHistoryPoint[], null]
  const snap = snapEs && EN ? snapshotToEnglish(snapEs) : snapEs

  // Recent rate-change events recorded by the rate-watch cron
  const { data: rateEvents } = await sb
    .from('rate_change_events')
    .select('stay_date, old_price, new_price, detected_at')
    .eq('property_id', propertyId)
    .order('detected_at', { ascending: false })
    .limit(20)

  // Our booked nights (next 60 days) from the portal's own reservations
  const today = new Date().toISOString().slice(0, 10)
  const horizon60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
  const { data: futureRes } = await sb
    .from('reservations')
    .select('check_in, check_out, status')
    .eq('property_id', propertyId)
    .in('status', ['confirmed', 'checked_in'])
    .lte('check_in', horizon60)
    .gte('check_out', today)
  const bookedDays = new Set<string>()
  for (const r of futureRes ?? []) {
    const ci = new Date(r.check_in + 'T00:00:00')
    const co = new Date(r.check_out + 'T00:00:00')
    for (let d = new Date(ci); d < co; d.setDate(d.getDate() + 1)) {
      bookedDays.add(d.toISOString().slice(0, 10))
    }
  }

  return (
    <div className="min-h-screen pt-16" style={{ backgroundColor: '#F0EFED' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 space-y-10">

        {/* Header */}
        <div>
          <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
            Revenue Management NOK
          </p>
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">
            {EN ? `The strategy behind ${property.name}` : `La estrategia detrás de ${property.name}`}
          </h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(26,26,26,0.45)' }}>
            {EN ? 'How we set your rate every day and how your unit compares to its area.' : 'Cómo decidimos tu tarifa cada día y cómo se compara tu unidad con su zona.'}
          </p>
        </div>

        {!snap ? (
          <div className="rounded-2xl p-8 nok-card">
            <p className="font-serif text-2xl font-light text-[#1A1A1A] mb-2">{EN ? 'We are preparing this view' : 'Estamos preparando esta vista'}</p>
            <p className="text-sm" style={{ color: 'rgba(26,26,26,0.5)' }}>
              {EN
                ? 'The Revenue Management module is being configured for this property. Very soon you will see the pricing strategy and area comparison here.'
                : 'El módulo de Revenue Management se está configurando para esta propiedad. Muy pronto vas a poder ver aquí la estrategia de precios y la comparación con tu zona.'}
            </p>
          </div>
        ) : (
          <>
            {/* Metric tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label={EN ? 'Published rate today' : 'Tarifa publicada hoy'} value={fmtUsd(snap.todayPrice)} sub={EN ? 'Recalculated daily' : 'Recalculada a diario'} />
              <MetricCard
                label={EN ? 'Occupancy next 30 days' : 'Ocupación próx. 30 días'}
                value={fmtPct01(snap.occWindows[1]?.unit ?? null)}
                sub={snap.occWindows[1]?.zone != null ? (EN ? `The area is at ${fmtPct01(snap.occWindows[1].zone)}` : `La zona va en ${fmtPct01(snap.occWindows[1].zone)}`) : undefined}
              />
              <MetricCard
                label={EN ? 'Nights sold last 7 days' : 'Noches vendidas últimos 7 días'}
                value={snap.pickup7 != null ? String(Math.round(snap.pickup7)) : '—'}
                sub={EN ? 'Recent booking pace' : 'Ritmo de reserva reciente'}
              />
              <MetricCard
                label={EN ? 'Position vs. area' : 'Posición vs. zona'}
                value={snap.posVsZonePct != null ? `${snap.posVsZonePct > 0 ? '+' : ''}${snap.posVsZonePct}%` : '—'}
                sub={snap.zoneListings ? (EN ? `${snap.zoneListings} comparable properties` : `${snap.zoneListings} propiedades comparables`) : undefined}
              />
            </div>

            {/* Strategy */}
            <div>
              <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-1">{EN ? 'What we are doing with your rate' : 'Qué estamos haciendo con tu tarifa'}</h2>
              <p className="text-sm mb-5" style={{ color: 'rgba(26,26,26,0.45)' }}>
                {EN ? 'These are the levers configured specifically for your unit' : 'Estas son las palancas configuradas específicamente para tu unidad'}{snap.tierName ? ` (plan ${snap.tierName})` : ''}.
              </p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {snap.strategy.map(s => (
                  <div key={s.tag} className="rounded-2xl p-5 nok-card">
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#D6A700' }}>{s.tag}</p>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{s.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate vs zone chart */}
            {snap.rateDays.length >= 7 && (
              <div className="rounded-2xl p-6 nok-card">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                  <h2 className="font-serif text-2xl font-light text-[#1A1A1A]">{EN ? 'Your rate vs. the area' : 'Tu tarifa vs. la zona'}</h2>
                  <div className="flex gap-5 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#0E6845' }} /> {EN ? 'Your rate' : 'Tu tarifa'}</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#0080C6' }} /> {EN ? 'Area median' : 'Mediana de la zona'}</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(148,184,207,0.25)' }} /> {EN ? 'Area range' : 'Rango de la zona'}</span>
                  </div>
                </div>
                <RateChartInteractive days={snap.rateDays} en={EN} />
                <p className="text-xs mt-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  {EN
                    ? 'In USD. Hover over the chart to see each night. The area is the set of comparable properties around your unit.'
                    : 'En USD. Pasa el cursor por el gráfico para ver cada noche. La zona son las propiedades comparables alrededor de tu unidad.'}
                </p>
              </div>
            )}

            {/* Daily occupancy: zone curve + our booked nights */}
            {snap.zoneOccDaily.length >= 7 && (
              <div className="rounded-2xl p-6 nok-card">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                  <h2 className="font-serif text-2xl font-light text-[#1A1A1A]">{EN ? 'Area occupancy, day by day' : 'Ocupación de la zona, día a día'}</h2>
                  <div className="flex gap-5 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#0080C6' }} /> {EN ? '% of the area already booked' : '% de la zona ya reservado'}</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ backgroundColor: '#0E6845' }} /> {EN ? 'Your booked nights' : 'Tus noches reservadas'}</span>
                  </div>
                </div>
                <OccDailyChartInteractive zone={snap.zoneOccDaily} booked={[...bookedDays]} en={EN} />
                <p className="text-xs mt-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  {EN
                    ? 'The line shows what share of comparable properties is already booked for each night. The green strip is your sold nights: every green night over a low-occupancy area is a night we won from the market.'
                    : 'La línea muestra qué porcentaje de las propiedades comparables ya está reservado para cada noche. La franja verde son tus noches ya vendidas: cada noche verde sobre una zona con poca ocupación es una noche que le ganamos al mercado.'}
                </p>
              </div>
            )}

            {/* Occupancy vs zone */}
            <div className="grid lg:grid-cols-2 gap-4 items-start">
              <div className="rounded-2xl p-6 nok-card">
                <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-4">{EN ? 'Occupancy: your unit vs. the area' : 'Ocupación: tu unidad vs. la zona'}</h2>
                <OccCompare windows={snap.occWindows} />
              </div>

              {/* Signals */}
              <div className="rounded-2xl p-6 nok-card">
                <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-4">{EN ? 'Engine signals' : 'Señales del motor'}</h2>
                {snap.flags.length === 0 ? (
                  <p className="text-sm" style={{ color: 'rgba(26,26,26,0.5)' }}>
                    {EN ? 'No active alerts — the strategy is performing as expected. ✓' : 'Sin alertas activas — la estrategia está funcionando dentro de lo esperado. ✓'}
                  </p>
                ) : (
                  <div className="space-y-4">
                    {snap.flags.map(f => {
                      const es = EN ? FLAG_EN[f.name] : FLAG_ES[f.name]
                      return (
                        <div key={f.name} className="flex gap-3">
                          <div
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
                            style={{ backgroundColor: 'rgba(214,167,0,0.15)', color: '#D6A700', border: '1px solid rgba(214,167,0,0.3)' }}
                          >
                            !
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[#1A1A1A]">{es?.title ?? f.name}</p>
                            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(26,26,26,0.5)' }}>
                              {es?.text ?? f.description}
                            </p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Base price breakdown */}
            {snap.basePrice && (
              <div className="rounded-2xl p-6 nok-card">
                <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-1">{EN ? 'Where your base price comes from' : 'De dónde sale tu precio base'}</h2>
                <p className="text-sm mb-6" style={{ color: 'rgba(26,26,26,0.45)' }}>
                  {EN
                    ? "The engine starts from what your market charges and adjusts it for your unit's real characteristics. This is how today's recommendation is built:"
                    : 'El motor parte de lo que cobra tu mercado y lo ajusta por las características reales de tu unidad. Así se construye la recomendación de hoy:'}
                </p>
                <div className="grid lg:grid-cols-2 gap-8 items-start">
                  <BaseBreakdown bp={snap.basePrice} />
                  <div className="space-y-4">
                    <div className="flex items-end gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{EN ? 'Recommended' : 'Recomendado'}</p>
                        <p className="font-serif text-4xl font-light text-[#1A1A1A]">{fmtUsd(snap.basePrice.recommended)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{EN ? 'Applied' : 'Aplicado'}</p>
                        <p className="font-serif text-4xl font-light" style={{ color: '#0E6845' }}>{fmtUsd(snap.basePrice.selected)}</p>
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.55)' }}>
                      {snap.basePrice.selected < snap.basePrice.recommended
                        ? (EN
                            ? `Today we apply a base price ${fmtUsd(snap.basePrice.recommended - snap.basePrice.selected)} below the recommendation — a deliberately competitive profile to keep occupancy above the area. When booking pace allows it, we move it closer to the recommendation.`
                            : `Hoy aplicamos un precio base ${fmtUsd(snap.basePrice.recommended - snap.basePrice.selected)} por debajo del recomendado — un perfil deliberadamente competitivo para sostener la ocupación por encima de la zona. Cuando el ritmo de reservas lo permite, lo acercamos al recomendado.`)
                        : snap.basePrice.selected > snap.basePrice.recommended
                          ? (EN ? 'Today we apply a base price above the recommendation, leveraging your unit’s strong booking pace.' : 'Hoy aplicamos un precio base por encima del recomendado, aprovechando el buen ritmo de reservas de tu unidad.')
                          : (EN ? 'Today we apply exactly the base price recommended by the engine.' : 'Hoy aplicamos exactamente el precio base recomendado por el motor.')}
                      {snap.basePrice.anchorCredibility != null && (EN ? ` Model confidence: ${snap.basePrice.anchorCredibility}%.` : ` Confianza del modelo: ${snap.basePrice.anchorCredibility}%.`)}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(26,26,26,0.35)' }}>
                      {EN
                        ? `Engine working range: ${fmtUsd(snap.basePrice.conservative)} (conservative) – ${fmtUsd(snap.basePrice.aggressive)} (aggressive). Seasonality, events, day of week and real-time demand then act on top of this base price.`
                        : `Rango de trabajo del motor: ${fmtUsd(snap.basePrice.conservative)} (conservador) – ${fmtUsd(snap.basePrice.aggressive)} (agresivo). Sobre este precio base actúan después la temporada, los eventos, el día de la semana y la demanda en tiempo real.`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Market position + base price evolution */}
            {(snap.marketPosition || baseHistory.length >= 5) && (
              <div className="grid lg:grid-cols-2 gap-4 items-start">
                {snap.marketPosition && (
                  <div className="rounded-2xl p-6 nok-card">
                    <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-1">{EN ? 'Your position in the market' : 'Tu posición en el mercado'}</h2>
                    <p className="text-sm mb-4" style={{ color: 'rgba(26,26,26,0.45)' }}>
                      {(() => {
                        const [y, m] = snap.marketPosition.monthISO.split('-')
                        const mes = EN
                          ? new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
                          : MESES_LARGOS[+m - 1]
                        return EN
                          ? `Occupancy in ${mes}: your unit is above ${snap.marketPosition.percentile}% of comparable listings in its market.`
                          : `Ocupación de ${mes}: tu unidad está por encima del ${snap.marketPosition.percentile}% de las propiedades comparables de su mercado.`
                      })()}
                    </p>
                    <div className="flex items-end gap-5 mb-3">
                      <p className="font-serif text-5xl font-light" style={{ color: '#0E6845' }}>
                        {EN ? `Top ${Math.max(1, 100 - snap.marketPosition.percentile)}%` : `Top ${Math.max(1, 100 - snap.marketPosition.percentile)}%`}
                      </p>
                      <p className="text-sm pb-1" style={{ color: 'rgba(26,26,26,0.45)' }}>
                        {EN ? `with ${Math.round(snap.marketPosition.occupancy * 100)}% occupancy` : `con ${Math.round(snap.marketPosition.occupancy * 100)}% de ocupación`}
                      </p>
                    </div>
                    <MarketHistogram mp={snap.marketPosition} />
                    <p className="text-xs mt-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
                      {EN
                        ? 'Each bar is a share of the market by occupancy level. The green bar is where your unit sits this month.'
                        : 'Cada barra es una porción del mercado según su nivel de ocupación. La barra verde es donde está tu unidad este mes.'}
                    </p>
                  </div>
                )}
                {baseHistory.length >= 5 && (
                  <div className="rounded-2xl p-6 nok-card">
                    <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-1">{EN ? 'Base price over time' : 'Evolución del precio base'}</h2>
                    <p className="text-sm mb-4" style={{ color: 'rgba(26,26,26,0.45)' }}>
                      {EN
                        ? 'How the engine recommendation has moved, and the base we actually applied.'
                        : 'Cómo se ha movido la recomendación del motor, y la base que realmente aplicamos.'}
                    </p>
                    <BaseHistoryChart points={baseHistory} />
                    <div className="flex gap-5 mt-2 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
                      <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-0.5 rounded-full" style={{ backgroundColor: '#0E6845' }} /> {EN ? 'Applied' : 'Aplicado'}</span>
                      <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-0.5 rounded-full border-b border-dashed" style={{ borderColor: '#0080C6' }} /> {EN ? 'Recommended' : 'Recomendado'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Recent rate changes feed */}
            <div className="rounded-2xl p-6 nok-card">
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-1">
                <h2 className="font-serif text-2xl font-light text-[#1A1A1A]">{EN ? 'Recent rate changes' : 'Cambios recientes de tarifa'}</h2>
                {postingCount7d != null && postingCount7d > 0 && (
                  <p className="text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
                    {EN
                      ? `The engine published prices ${postingCount7d} time${postingCount7d > 1 ? 's' : ''} in the last 7 days`
                      : `El motor publicó precios ${postingCount7d} ${postingCount7d > 1 ? 'veces' : 'vez'} en los últimos 7 días`}
                  </p>
                )}
              </div>
              {(rateEvents ?? []).length === 0 ? (
                <p className="text-sm mt-3" style={{ color: 'rgba(26,26,26,0.5)' }}>
                  {EN
                    ? 'Monitoring is active. Every time the engine moves a nightly rate, the change will show up here so you always know what is being adjusted.'
                    : 'El monitoreo está activo. Cada vez que el motor mueva la tarifa de una noche, el cambio va a aparecer aquí para que siempre sepas qué se está ajustando.'}
                </p>
              ) : (
                <div className="mt-3 divide-y" style={{ borderColor: 'rgba(26,26,26,0.06)' }}>
                  {(rateEvents ?? []).map((e: any, i: number) => {
                    const up = e.new_price > (e.old_price ?? 0)
                    const pct = e.old_price ? Math.round(((e.new_price - e.old_price) / e.old_price) * 100) : null
                    return (
                      <div key={i} className="flex items-center justify-between gap-4 py-2.5 text-sm" style={{ borderColor: 'rgba(26,26,26,0.06)' }}>
                        <span style={{ color: 'rgba(26,26,26,0.65)' }}>
                          {EN ? 'Night of' : 'Noche del'} <span className="font-medium text-[#1A1A1A]">{fmtDay(e.stay_date)}</span>
                        </span>
                        <span className="flex items-center gap-2 tabular-nums whitespace-nowrap">
                          <span style={{ color: 'rgba(26,26,26,0.4)' }}>${Math.round(e.old_price ?? 0)}</span>
                          <span style={{ color: 'rgba(26,26,26,0.3)' }}>→</span>
                          <span className="font-medium" style={{ color: up ? '#0E6845' : '#833B0E' }}>${Math.round(e.new_price)}</span>
                          {pct != null && pct !== 0 && (
                            <span className="text-xs" style={{ color: up ? '#0E6845' : '#833B0E' }}>({pct > 0 ? '+' : ''}{pct}%)</span>
                          )}
                          <span className="text-xs" style={{ color: 'rgba(26,26,26,0.35)' }}>· {fmtDay(String(e.detected_at).slice(0, 10))}</span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* How the engine responds to demand */}
            <div>
              <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-1">{EN ? 'How the engine responds to demand' : 'Cómo responde el motor a la demanda'}</h2>
              <p className="text-sm mb-5" style={{ color: 'rgba(26,26,26,0.45)' }}>
                {EN ? 'Your rate is not fixed: it reacts every day to what happens in your area.' : 'Tu tarifa no es fija: reacciona todos los días a lo que pasa en tu zona.'}
              </p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {snap.demandSensitivityPct != null && (
                  <div className="rounded-2xl p-5 nok-card">
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#D6A700' }}>{EN ? 'Demand sensitivity' : 'Sensibilidad a la demanda'}</p>
                    <p className="font-serif text-3xl font-light text-[#1A1A1A] mb-2">{snap.demandSensitivityPct}%</p>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.6)' }}>
                      {EN
                        ? `When the area fills faster than expected, the rate goes up; when pace slows, it comes down to avoid losing nights. At ${snap.demandSensitivityPct}%, your unit responds ${snap.demandSensitivityPct >= 100 ? 'with the full strength of the market signal' : 'in a dampened way to the market signal'}.`
                        : `Cuando la zona se llena más rápido de lo esperado, la tarifa sube; cuando el ritmo afloja, baja para no perder noches. Al ${snap.demandSensitivityPct}%, tu unidad responde ${snap.demandSensitivityPct >= 100 ? 'con toda la fuerza de la señal del mercado' : 'de forma amortiguada a la señal del mercado'}.`}
                    </p>
                  </div>
                )}
                <div className="rounded-2xl p-5 nok-card">
                  <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#D6A700' }}>{EN ? 'Occupancy pacing' : 'Ritmo de ocupación'}</p>
                  <p className="font-serif text-3xl font-light text-[#1A1A1A] mb-2">{snap.pacingAdjusted ? (EN ? 'Active' : 'Activo') : (EN ? 'Standard' : 'Estándar')}</p>
                  <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.6)' }}>
                    {EN
                      ? 'The engine compares how many nights you should have sold by now vs. how many you have. If you are ahead, it defends rate; if behind, it gets more aggressive to close the gap.'
                      : 'El motor compara cuántas noches deberías tener vendidas a esta altura vs. cuántas tienes. Si vas adelantado, defiende tarifa; si vas atrasado, se vuelve más agresivo para cerrar la brecha.'}
                  </p>
                </div>
                {snap.historicalAnchoringPct != null && (
                  <div className="rounded-2xl p-5 nok-card">
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#D6A700' }}>{EN ? 'Historical anchoring' : 'Anclaje al historial'}</p>
                    <p className="font-serif text-3xl font-light text-[#1A1A1A] mb-2">{snap.historicalAnchoringPct}%</p>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.6)' }}>
                      {snap.historicalAnchoringPct === 0
                        ? (EN
                            ? "Your price is based 100% on the current market, without being dragged by the unit's historical rates — ideal to capture each season's real potential."
                            : 'Tu precio se basa 100% en el mercado actual, sin dejarse arrastrar por tarifas históricas de la unidad — ideal para capturar el potencial real de cada temporada.')
                        : (EN
                            ? `${snap.historicalAnchoringPct}% of the price anchors to your unit's historical rates for stability, and the rest follows the current market.`
                            : `Un ${snap.historicalAnchoringPct}% del precio se ancla a las tarifas históricas de tu unidad para dar estabilidad, y el resto sigue al mercado actual.`)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Insights */}
            {(snap.revenueScore30 != null || snap.occRatio30 != null || snap.upcomingSeasons.length > 0) && (
              <div>
                <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-5">{EN ? 'Insights for your unit' : 'Insights de tu unidad'}</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {snap.revenueScore30 != null && (
                    <MetricCard
                      label={EN ? 'Revenue score next 30 days' : 'Revenue score próx. 30 días'}
                      value={`${snap.revenueScore30}/100`}
                      sub={EN ? 'How well your unit is capturing revenue vs. its potential' : 'Qué tan bien está capturando ingresos tu unidad vs. su potencial'}
                    />
                  )}
                  {snap.occRatio30 != null && snap.occRatio30 > 0 && (
                    <MetricCard
                      label={EN ? 'Occupancy vs. area' : 'Ocupación vs. zona'}
                      value={`${snap.occRatio30.toFixed(1)}×`}
                      sub={EN ? "Times above your area's occupancy (next 30 days)" : 'Veces por encima de la ocupación de tu zona (próx. 30 días)'}
                    />
                  )}
                  {snap.bookings30 != null && (
                    <MetricCard label={EN ? 'Bookings next 30 days' : 'Reservas próx. 30 días'} value={String(snap.bookings30)} sub={EN ? 'Confirmed reservations touching this period' : 'Reservas confirmadas que tocan este período'} />
                  )}
                  {snap.upcomingSeasons.length > 0 && (
                    <div className="rounded-2xl p-5 nok-card">
                      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(26,26,26,0.35)' }}>{EN ? 'Upcoming seasons' : 'Próximas temporadas'}</p>
                      <div className="space-y-2">
                        {snap.upcomingSeasons.map(s => (
                          <div key={s.name} className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="text-[#1A1A1A]">{s.name}</span>
                            <span className="text-xs whitespace-nowrap" style={{ color: 'rgba(26,26,26,0.4)' }}>{fmtRange(s)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Methodology note */}
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(26,26,26,0.3)' }}>
              {EN
                ? `Prices are recalculated and published automatically every day${snap.horizonDays ? ` with a ${snap.horizonDays}-day horizon` : ''}. This view refreshes every hour, and rate changes are monitored hourly by NOK Revenue Management. Area amounts may be converted from local currency to USD at the daily rate.`
                : `Los precios se recalculan y publican automáticamente todos los días${snap.horizonDays ? ` con un horizonte de ${snap.horizonDays} días` : ''}. Esta vista se refresca cada hora y los cambios de tarifa se monitorean cada hora por Revenue Management NOK. Los montos de la zona pueden convertirse de moneda local a USD con la tasa del día.`}
            </p>
          </>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between py-6 text-xs"
          style={{ borderTop: '1px solid rgba(26,26,26,0.06)', color: 'rgba(26,26,26,0.2)' }}
        >
          <span className="font-serif text-sm tracking-[0.2em]">NOK</span>
          <span>Curated stays designed to flow with you · <a href="https://nok.rent" target="_blank" rel="noopener" className="hover:text-[#833B0E] transition-colors">nok.rent</a></span>
        </div>
      </div>
    </div>
  )
}
