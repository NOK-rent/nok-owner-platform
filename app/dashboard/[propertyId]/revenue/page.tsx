import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import { getRevenueSnapshot, type RateDay, type OccWindow } from '@/lib/wheelhouse'

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
function fmtDay(iso: string) {
  const [, m, d] = iso.split('-')
  return `${+d} ${MESES_CORTOS[+m - 1]}`
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

// ── Server-rendered SVG chart: our rate vs zone ─────────────────────────────

function RateChart({ days }: { days: RateDay[] }) {
  const W = 860, H = 280, P = { t: 12, r: 12, b: 28, l: 46 }
  const pts = days.filter(d => d.zoneMedian != null)
  if (pts.length < 7) return null
  const ys = pts.flatMap(d => [d.zoneLow, d.zoneHigh, d.ours, d.zoneMedian]).filter((v): v is number => v != null)
  const step = Math.max(25, Math.ceil((Math.max(...ys) - Math.min(...ys)) / 200) * 50)
  const yMin = Math.floor(Math.min(...ys) / step) * step
  const yMax = Math.ceil(Math.max(...ys) / step) * step
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - yMin) / (yMax - yMin || 1))

  const line = (key: 'ours' | 'zoneMedian') =>
    pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y((d[key] ?? d.zoneMedian) as number).toFixed(1)}`).join('')

  const band =
    pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y((d.zoneHigh ?? d.zoneMedian) as number).toFixed(1)}`).join('') +
    [...pts].reverse().map((d, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y((d.zoneLow ?? d.zoneMedian) as number).toFixed(1)}`).join('') +
    'Z'

  const gridVals: number[] = []
  for (let v = yMin; v <= yMax; v += step) gridVals.push(v)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Tu tarifa comparada con la mediana y el rango de la zona">
      {gridVals.map(v => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(242,242,242,0.07)" strokeWidth={1} />
          <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="rgba(242,242,242,0.35)">${v}</text>
        </g>
      ))}
      {pts.map((d, i) =>
        i % 10 === 0 ? (
          <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(242,242,242,0.35)">
            {fmtDay(d.date)}
          </text>
        ) : null,
      )}
      <path d={band} fill="rgba(148,184,207,0.14)" />
      <path d={line('zoneMedian')} fill="none" stroke="#3D9BD1" strokeWidth={2} strokeLinejoin="round" />
      <path d={line('ours')} fill="none" stroke="#4ade80" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  )
}

function OccCompare({ windows }: { windows: OccWindow[] }) {
  return (
    <div className="space-y-4">
      {windows.map(w => (
        <div key={w.label}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span style={{ color: 'rgba(242,242,242,0.45)' }}>{w.label}</span>
            <span style={{ color: 'rgba(242,242,242,0.65)' }}>
              Tu unidad {fmtPct01(w.unit)} · Zona {fmtPct01(w.zone)}
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(242,242,242,0.06)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((w.unit ?? 0) * 100))}%`, backgroundColor: '#4ade80' }} />
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(242,242,242,0.06)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.round((w.zone ?? 0) * 100))}%`, backgroundColor: '#3D9BD1' }} />
            </div>
          </div>
        </div>
      ))}
      <div className="flex gap-5 pt-1 text-xs" style={{ color: 'rgba(242,242,242,0.45)' }}>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#4ade80' }} /> Tu unidad</span>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: '#3D9BD1' }} /> Zona</span>
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl p-5 nok-card">
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(242,242,242,0.35)' }}>{label}</p>
      <p className="font-serif text-4xl font-light text-[#F2F2F2] leading-none">{value}</p>
      {sub && <p className="text-xs mt-2" style={{ color: 'rgba(242,242,242,0.3)' }}>{sub}</p>}
    </div>
  )
}

export default async function RevenuePage({ params }: Props) {
  const { propertyId } = await params
  const { property } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const listingId = property.guesty_listing_id as string | null
  const snap = listingId ? await getRevenueSnapshot(listingId) : null

  return (
    <div className="min-h-screen pt-16" style={{ backgroundColor: '#1D1D1B' }}>
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 space-y-10">

        {/* Header */}
        <div>
          <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(242,242,242,0.35)' }}>
            Revenue Management NOK
          </p>
          <h1 className="font-serif text-4xl font-light text-[#F2F2F2]">
            La estrategia detrás de {property.name}
          </h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(242,242,242,0.45)' }}>
            Cómo decidimos tu tarifa cada día y cómo se compara tu unidad con su zona.
          </p>
        </div>

        {!snap ? (
          <div className="rounded-2xl p-8 nok-card">
            <p className="font-serif text-2xl font-light text-[#F2F2F2] mb-2">Estamos preparando esta vista</p>
            <p className="text-sm" style={{ color: 'rgba(242,242,242,0.5)' }}>
              El módulo de Revenue Management se está configurando para esta propiedad. Muy pronto vas a poder ver aquí la estrategia de precios y la comparación con tu zona.
            </p>
          </div>
        ) : (
          <>
            {/* Metric tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Tarifa publicada hoy" value={fmtUsd(snap.todayPrice)} sub="Recalculada a diario" />
              <MetricCard
                label="Ocupación próx. 30 días"
                value={fmtPct01(snap.occWindows[1]?.unit ?? null)}
                sub={snap.occWindows[1]?.zone != null ? `La zona va en ${fmtPct01(snap.occWindows[1].zone)}` : undefined}
              />
              <MetricCard
                label="Noches vendidas últimos 7 días"
                value={snap.pickup7 != null ? String(Math.round(snap.pickup7)) : '—'}
                sub="Ritmo de reserva reciente"
              />
              <MetricCard
                label="Posición vs. zona"
                value={snap.posVsZonePct != null ? `${snap.posVsZonePct > 0 ? '+' : ''}${snap.posVsZonePct}%` : '—'}
                sub={snap.zoneListings ? `${snap.zoneListings} propiedades comparables` : undefined}
              />
            </div>

            {/* Strategy */}
            <div>
              <h2 className="font-serif text-2xl font-light text-[#F2F2F2] mb-1">Qué estamos haciendo con tu tarifa</h2>
              <p className="text-sm mb-5" style={{ color: 'rgba(242,242,242,0.45)' }}>
                Estas son las palancas configuradas específicamente para tu unidad{snap.tierName ? ` (plan ${snap.tierName})` : ''}.
              </p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {snap.strategy.map(s => (
                  <div key={s.tag} className="rounded-2xl p-5 nok-card">
                    <p className="text-xs uppercase tracking-widest mb-2" style={{ color: '#D6A700' }}>{s.tag}</p>
                    <p className="text-sm leading-relaxed" style={{ color: 'rgba(242,242,242,0.65)' }}>{s.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Rate vs zone chart */}
            {snap.rateDays.length >= 7 && (
              <div className="rounded-2xl p-6 nok-card">
                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                  <h2 className="font-serif text-2xl font-light text-[#F2F2F2]">Tu tarifa vs. la zona</h2>
                  <div className="flex gap-5 text-xs" style={{ color: 'rgba(242,242,242,0.45)' }}>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#4ade80' }} /> Tu tarifa</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#3D9BD1' }} /> Mediana de la zona</span>
                    <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(148,184,207,0.25)' }} /> Rango de la zona</span>
                  </div>
                </div>
                <RateChart days={snap.rateDays} />
                <p className="text-xs mt-3" style={{ color: 'rgba(242,242,242,0.35)' }}>
                  Próximas {Math.min(60, snap.rateDays.length)} noches, en USD. La zona son las propiedades comparables alrededor de tu unidad.
                </p>
              </div>
            )}

            {/* Occupancy vs zone */}
            <div className="grid lg:grid-cols-2 gap-4 items-start">
              <div className="rounded-2xl p-6 nok-card">
                <h2 className="font-serif text-2xl font-light text-[#F2F2F2] mb-4">Ocupación: tu unidad vs. la zona</h2>
                <OccCompare windows={snap.occWindows} />
              </div>

              {/* Signals */}
              <div className="rounded-2xl p-6 nok-card">
                <h2 className="font-serif text-2xl font-light text-[#F2F2F2] mb-4">Señales del motor</h2>
                {snap.flags.length === 0 ? (
                  <p className="text-sm" style={{ color: 'rgba(242,242,242,0.5)' }}>
                    Sin alertas activas — la estrategia está funcionando dentro de lo esperado. ✓
                  </p>
                ) : (
                  <div className="space-y-4">
                    {snap.flags.map(f => {
                      const es = FLAG_ES[f.name]
                      return (
                        <div key={f.name} className="flex gap-3">
                          <div
                            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm"
                            style={{ backgroundColor: 'rgba(214,167,0,0.15)', color: '#D6A700', border: '1px solid rgba(214,167,0,0.3)' }}
                          >
                            !
                          </div>
                          <div>
                            <p className="text-sm font-medium text-[#F2F2F2]">{es?.title ?? f.name}</p>
                            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(242,242,242,0.5)' }}>
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

            {/* Methodology note */}
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(242,242,242,0.3)' }}>
              Los precios se recalculan y publican automáticamente todos los días{snap.horizonDays ? ` con un horizonte de ${snap.horizonDays} días` : ''}.
              Datos de zona actualizados varias veces al día por Revenue Management NOK. Los montos de la zona pueden convertirse de moneda local a USD con la tasa del día.
            </p>
          </>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between py-6 text-xs"
          style={{ borderTop: '1px solid rgba(242,242,242,0.06)', color: 'rgba(242,242,242,0.2)' }}
        >
          <span className="font-serif text-sm tracking-[0.2em]">NOK</span>
          <span>Curated stays designed to flow with you · <a href="https://nok.rent" target="_blank" rel="noopener" className="hover:text-[#B9B5DC] transition-colors">nok.rent</a></span>
        </div>
      </div>
    </div>
  )
}
