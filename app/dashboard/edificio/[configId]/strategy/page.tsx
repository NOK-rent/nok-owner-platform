import Link from 'next/link'
import { loadOwnerBuilding } from '@/lib/edificio'
import { getLocale, type Locale } from '@/lib/i18n'
import { computeBuildingFacts, getBuildingBriefing, todayYmd, type UnitFacts } from '@/lib/ai/building-briefing'

interface Props { params: Promise<{ configId: string }> }

export const revalidate = 0 // página por usuario (auth)

// Idioma siempre por parámetro — nunca estado mutable a nivel módulo.
const T: Record<Locale, Record<string, string>> = {
  es: {
    title: 'Strategy',
    subtitle: 'Cada unidad tiene precio dinámico propio, ajustado a diario por Revenue Management NOK según demanda, temporada y ritmo de reservas de la zona. Aquí ves el edificio completo; en cada unidad puedes ver el detalle.',
    briefing: 'Briefing semanal NOK AI',
    occ30: 'Ocupación próx. 30 días', occ60: 'Ocupación próx. 60 días', occ90: 'Ocupación próx. 90 días',
    adr30: 'ADR últimos 30 días', newBookings: 'Reservas nuevas (7 días)', avgRate: 'Tarifa promedio publicada (30 d)',
    netPerNight: 'neto por noche', netNew: 'neto', perNight: 'por noche', building: 'todo el edificio',
    unitsTitle: 'Por unidad', unit: 'Unidad', o30: 'Ocup. 30 d', o90: 'Ocup. 90 d', adr: 'ADR 30 d',
    next: 'Próxima reserva', rate: 'Tarifa hoy / prom. 30 d', trend: 'Próx. 30 d', view: 'Ver estrategia',
    noNext: 'Sin reservas próximas', inactive: 'inactiva',
    changesTitle: 'Cambios recientes de tarifa', changesSub: 'Últimos 7 días · ajustes automáticos del motor de revenue',
    stay: 'noche del', how: 'Cómo funciona',
    how1: 'Precio dinámico: la tarifa de cada noche se recalcula todos los días con la demanda real de la zona, la temporada y qué tan cerca está la fecha. Una noche sin tarifa publicada no vale $0: simplemente aún no se ha cargado.',
    how2: 'Estancias mínimas: en fechas de alta demanda pedimos más noches por reserva para reducir limpiezas y huecos; en temporada baja se relajan para no perder reservas cortas.',
    how3: 'Cambios: si quieres bloquear fechas, ajustar un mínimo o revisar una tarifa puntual, escríbenos por Equipo NOK y el equipo de revenue lo evalúa contigo.',
    unitsNoBookings: 'unidades sin reservas próx. 30 días',
  },
  en: {
    title: 'Strategy',
    subtitle: 'Every unit has its own dynamic price, adjusted daily by NOK Revenue Management based on demand, season and booking pace in the area. This view covers the whole building; open any unit for the full detail.',
    briefing: 'NOK AI weekly briefing',
    occ30: 'Occupancy next 30 days', occ60: 'Occupancy next 60 days', occ90: 'Occupancy next 90 days',
    adr30: 'ADR last 30 days', newBookings: 'New bookings (7 days)', avgRate: 'Avg. published rate (30 d)',
    netPerNight: 'net per night', netNew: 'net', perNight: 'per night', building: 'whole building',
    unitsTitle: 'By unit', unit: 'Unit', o30: 'Occ. 30 d', o90: 'Occ. 90 d', adr: 'ADR 30 d',
    next: 'Next booking', rate: 'Rate today / avg. 30 d', trend: 'Next 30 d', view: 'View strategy',
    noNext: 'No upcoming bookings', inactive: 'inactive',
    changesTitle: 'Recent rate changes', changesSub: 'Last 7 days · automatic adjustments by the revenue engine',
    stay: 'night of', how: 'How it works',
    how1: 'Dynamic pricing: every night is repriced daily using real demand in the area, the season and how close the date is. A night without a published rate is not $0 — it simply has not been loaded yet.',
    how2: 'Minimum stays: on high-demand dates we require more nights per booking to reduce cleanings and gaps; in low season they relax so short stays are not lost.',
    how3: 'Changes: to block dates, adjust a minimum or review a specific rate, write to us via NOK Team and the revenue team will review it with you.',
    unitsNoBookings: 'units with no bookings next 30 days',
  },
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso: string, locale: Locale) {
  const [, m, d] = iso.split('-')
  return locale === 'en' ? `${MONTHS[+m - 1]} ${+d}` : `${+d} ${MESES[+m - 1]}`
}
function fmtMoney(n: number | null | undefined, currency = 'USD') {
  if (n == null || !Number.isFinite(n)) return '—'
  if (currency === 'COP') return `$${Math.round(n).toLocaleString('es-CO')} COP`
  return `$${Math.round(n).toLocaleString('en-US')}`
}
function occColor(pct: number) {
  if (pct >= 70) return '#0E6845'
  if (pct >= 40) return '#833B0E'
  return '#F20022'
}

/** Sparkline inline de tarifas publicadas (próximos 30 días). */
function Sparkline({ series }: { series: (number | null)[] }) {
  const pts = series.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null)
  if (pts.length < 2) return <span style={{ color: 'rgba(26,26,26,0.25)' }}>—</span>
  const W = 90, H = 24
  const min = Math.min(...pts.map(p => p[1])), max = Math.max(...pts.map(p => p[1]))
  const x = (i: number) => (i / (series.length - 1)) * W
  const y = (v: number) => max === min ? H / 2 : H - 2 - ((v - min) / (max - min)) * (H - 4)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(' ')
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="inline-block align-middle">
      <path d={d} fill="none" stroke="#833B0E" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default async function EdificioStrategyPage({ params }: Props) {
  const { configId } = await params
  const [{ config, properties, propertyIds, sb }, locale] = await Promise.all([loadOwnerBuilding(configId), getLocale()])
  const t = T[locale]
  const today = todayYmd()

  const idList = propertyIds.length ? propertyIds : ['00000000-0000-0000-0000-000000000000']
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
  const [facts, changesRes] = await Promise.all([
    computeBuildingFacts(sb, config, properties),
    sb.from('rate_change_events')
      .select('property_id, stay_date, old_price, new_price, detected_at')
      .in('property_id', idList).gte('detected_at', since7d)
      .order('detected_at', { ascending: false }).limit(15)
      .then((r: any) => r, () => ({ data: [] })),
  ])
  const briefing = await getBuildingBriefing(config, facts, locale)
  const nameOf: Record<string, string> = Object.fromEntries(properties.map(p => [p.id, p.name]))
  const changes: any[] = changesRes?.data ?? []
  const cur = facts.publishedRateCurrency

  const rows: UnitFacts[] = [...facts.perUnit].sort((a, b) => b.occ30 - a.occ30 || a.name.localeCompare(b.name, 'es', { numeric: true }))

  const tiles = [
    { label: t.occ30, value: `${facts.occNext30}%`, sub: t.building, color: occColor(facts.occNext30) },
    { label: t.occ60, value: `${facts.occNext60}%`, sub: t.building, color: occColor(facts.occNext60) },
    { label: t.occ90, value: `${facts.occNext90}%`, sub: t.building, color: occColor(facts.occNext90) },
    { label: t.adr30, value: fmtMoney(facts.adrLast30), sub: t.netPerNight, color: '#1A1A1A' },
    { label: t.newBookings, value: String(facts.newBookings7d), sub: `${fmtMoney(facts.newBookingsNetUSD)} ${t.netNew}`, color: '#1A1A1A' },
    { label: t.avgRate, value: fmtMoney(facts.avgPublishedRateNext30, cur), sub: t.perNight, color: '#1A1A1A' },
  ]

  const card = { backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }
  const muted = { color: 'rgba(26,26,26,0.4)' }

  return (
    <div className="px-5 sm:px-8 lg:px-16 py-8 sm:py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-light text-[#1A1A1A]">{t.title} — {config.name}</h1>
        <p className="text-sm mt-2 max-w-3xl" style={muted}>{t.subtitle}</p>
      </div>

      {briefing && (
        <div className="rounded-xl p-5 mb-8" style={{ backgroundColor: 'rgba(131,59,14,0.06)', border: '1px solid rgba(131,59,14,0.25)' }}>
          <div className="flex items-center gap-2 mb-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: '#833B0E' }}>{t.briefing}</p>
          </div>
          <p className="text-sm leading-relaxed text-[#1A1A1A]/85">{briefing}</p>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
        {tiles.map(k => (
          <div key={k.label} className="rounded-xl p-4 sm:p-5" style={card}>
            <p className="text-[11px] uppercase tracking-widest mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>{k.label}</p>
            <p className="font-serif text-2xl sm:text-3xl font-light" style={{ color: k.color }}>{k.value}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(26,26,26,0.3)' }}>{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabla por unidad */}
      <div className="rounded-xl mb-8 overflow-hidden" style={card}>
        <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-2" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
          <h2 className="font-serif text-xl font-light text-[#1A1A1A]">{t.unitsTitle}</h2>
          {facts.unitsWithoutBookingsNext30 > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(242,0,34,0.08)', color: '#F20022' }}>
              {facts.unitsWithoutBookingsNext30} {t.unitsNoBookings}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr className="text-[11px] uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.35)' }}>
                <th className="text-left font-medium px-5 py-3">{t.unit}</th>
                <th className="text-right font-medium px-3 py-3">{t.o30}</th>
                <th className="text-right font-medium px-3 py-3">{t.o90}</th>
                <th className="text-right font-medium px-3 py-3">{t.adr}</th>
                <th className="text-left font-medium px-3 py-3">{t.next}</th>
                <th className="text-right font-medium px-3 py-3">{t.rate}</th>
                <th className="text-center font-medium px-3 py-3">{t.trend}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(u => (
                <tr key={u.id} style={{ borderTop: '1px solid rgba(26,26,26,0.05)', opacity: u.active ? 1 : 0.5 }}>
                  <td className="px-5 py-3 font-medium text-[#1A1A1A] whitespace-nowrap">{u.name}{!u.active && <span className="text-xs ml-1" style={muted}>({t.inactive})</span>}</td>
                  <td className="px-3 py-3 text-right font-semibold whitespace-nowrap" style={{ color: occColor(u.occ30) }}>{u.occ30}%</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap" style={{ color: occColor(u.occ90) }}>{u.occ90}%</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap text-[#1A1A1A]">{fmtMoney(u.adr30)}</td>
                  <td className="px-3 py-3 whitespace-nowrap" style={u.nextCheckIn ? { color: '#1A1A1A' } : muted}>{u.nextCheckIn ? fmtDay(u.nextCheckIn, locale) : t.noNext}</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap text-[#1A1A1A]">
                    {u.rateToday != null || u.rateAvg30 != null ? `${fmtMoney(u.rateToday, u.rateCurrency)} / ${fmtMoney(u.rateAvg30, u.rateCurrency)}` : '—'}
                  </td>
                  <td className="px-3 py-3 text-center"><Sparkline series={u.rateSeries} /></td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Link href={`/dashboard/${u.id}/revenue`} className="text-xs font-medium hover:underline" style={{ color: '#833B0E' }}>{t.view} →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cambios recientes de tarifa */}
      {changes.length > 0 && (
        <div className="rounded-xl mb-8 overflow-hidden" style={card}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
            <h2 className="font-serif text-xl font-light text-[#1A1A1A]">{t.changesTitle}</h2>
            <p className="text-xs mt-0.5" style={muted}>{t.changesSub}</p>
          </div>
          <ul>
            {changes.map((c, i) => {
              const up = c.old_price != null && Number(c.new_price) > Number(c.old_price)
              const delta = c.old_price != null ? Math.round(((Number(c.new_price) - Number(c.old_price)) / Number(c.old_price)) * 100) : null
              return (
                <li key={i} className="px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" style={{ borderTop: i ? '1px solid rgba(26,26,26,0.05)' : undefined }}>
                  <span className="font-medium text-[#1A1A1A] min-w-[110px]">{nameOf[c.property_id] ?? '—'}</span>
                  <span style={muted}>{t.stay} {fmtDay(c.stay_date, locale)}</span>
                  <span className="ml-auto whitespace-nowrap">
                    {c.old_price != null && <span style={muted}>{fmtMoney(Number(c.old_price))} → </span>}
                    <span className="font-semibold" style={{ color: up ? '#0E6845' : '#F20022' }}>{fmtMoney(Number(c.new_price))}</span>
                    {delta != null && <span className="text-xs ml-1" style={{ color: up ? '#0E6845' : '#F20022' }}>({up ? '+' : ''}{delta}%)</span>}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Cómo funciona */}
      <div className="rounded-xl p-5" style={card}>
        <h2 className="font-serif text-xl font-light text-[#1A1A1A] mb-3">{t.how}</h2>
        <ul className="space-y-2 text-sm text-[#1A1A1A]/80">
          {[t.how1, t.how2, t.how3].map((line, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: '#833B0E' }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs mt-4" style={{ color: 'rgba(26,26,26,0.3)' }}>{locale === 'en' ? 'Updated' : 'Actualizado'} {fmtDay(today, locale)}</p>
      </div>
    </div>
  )
}
