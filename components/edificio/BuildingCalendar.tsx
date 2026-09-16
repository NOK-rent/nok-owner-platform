'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'

/** Celda ya resuelta en el servidor: una por unidad × día. */
export type CalendarCell =
  | { k: 'r'; ch: string | null; ini: string; t: string; s: boolean; e: boolean }   // reserva (s/e: primer/último día del tramo)
  | { k: 'b'; t: string }                                                            // bloqueo del propietario / calendario
  | { k: 'f'; p: number | null }                                                     // libre (p: tarifa publicada)

export interface CalendarUnit {
  id: string
  name: string
  active: boolean
  cells: CalendarCell[]
  occupancy: number   // 0–100 del mes
}

interface Props {
  configId: string
  year: number
  month: number
  days: string[]            // YYYY-MM-DD del mes
  units: CalendarUnit[]
  dailyOccupancy: number[]  // 0–100 por día (unidades reservadas / activas)
  currency: string
  today: string
}

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DOW_ES = ['D','L','M','M','J','V','S']

const CHANNEL_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  airbnb:  { bg: 'rgba(239,68,68,0.16)',  border: '#ef4444', text: '#C81E3C', label: 'Airbnb' },
  booking: { bg: 'rgba(0,128,198,0.16)',  border: '#0080C6', text: '#01679E', label: 'Booking.com' },
  direct:  { bg: 'rgba(14,104,69,0.16)',  border: '#0E6845', text: '#0E6845', label: 'Directa' },
  vrbo:    { bg: 'rgba(77,67,158,0.16)',  border: '#4D439E', text: '#4D439E', label: 'Vrbo' },
}
const DEFAULT_CHANNEL = { bg: 'rgba(131,59,14,0.16)', border: '#833B0E', text: '#833B0E', label: 'Otro' }

// Misma lógica que CalendarView.getChannelStyle (los canales de Guesty traen variantes)
export function getChannelStyle(channel: string | null) {
  const c = (channel ?? '').toLowerCase()
  if (!c) return DEFAULT_CHANNEL
  if (c.includes('airbnb')) return CHANNEL_COLORS.airbnb
  if (c.includes('booking')) return CHANNEL_COLORS.booking
  if (c.includes('vrbo') || c.includes('homeaway')) return CHANNEL_COLORS.vrbo
  if (c.includes('direct') || c === 'owner' || c === 'manual' || c.includes('website')) return CHANNEL_COLORS.direct
  return DEFAULT_CHANNEL
}

function fmtPrice(p: number, currency: string) {
  if (currency === 'COP') return `${Math.round(p / 1000)}k`
  return `$${Math.round(p)}`
}

function occColor(pct: number) {
  if (pct >= 70) return '#0E6845'
  if (pct >= 40) return '#833B0E'
  return '#F20022'
}

export default function BuildingCalendar({ configId, year, month, days, units, dailyOccupancy, currency, today }: Props) {
  const router = useRouter()

  function navigate(delta: number) {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1) { m = 12; y-- }
    router.push(`/dashboard/edificio/${configId}/calendario?month=${m}&year=${y}`)
  }

  const monthOcc = units.filter(u => u.active).length
    ? Math.round(units.filter(u => u.active).reduce((s, u) => s + u.occupancy, 0) / units.filter(u => u.active).length)
    : 0

  const navBtn = 'w-9 h-9 flex items-center justify-center rounded-xl cursor-pointer transition-colors'
  const navStyle = { color: 'rgba(26,26,26,0.45)', border: '1px solid rgba(26,26,26,0.07)' }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.07)' }}>
      {/* Navegación */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
        <button onClick={() => navigate(-1)} className={navBtn} style={navStyle} aria-label="Mes anterior">‹</button>
        <div className="text-center">
          <h2 className="font-serif text-xl font-light text-[#1A1A1A]">{MONTHS_ES[month - 1]} {year}</h2>
          <p className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>Ocupación del edificio: <span className="font-semibold" style={{ color: occColor(monthOcc) }}>{monthOcc}%</span></p>
        </div>
        <button onClick={() => navigate(1)} className={navBtn} style={navStyle} aria-label="Mes siguiente">›</button>
      </div>

      {/* Grid — scroll horizontal dentro del contenedor, nunca en el body */}
      <div className="overflow-x-auto">
        <table className="border-collapse text-[10px]" style={{ minWidth: `${140 + days.length * 30 + 56}px` }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 text-left px-3 py-2 font-medium uppercase tracking-widest" style={{ backgroundColor: '#FFFFFF', color: 'rgba(26,26,26,0.35)', minWidth: 140, borderBottom: '1px solid rgba(26,26,26,0.06)', borderRight: '1px solid rgba(26,26,26,0.06)' }}>Unidad</th>
              {days.map(d => {
                const dow = new Date(d + 'T00:00:00').getDay()
                const isToday = d === today
                const weekend = dow === 0 || dow === 6
                return (
                  <th key={d} className="py-1.5 text-center font-medium" style={{ minWidth: 30, width: 30, borderBottom: '1px solid rgba(26,26,26,0.06)', backgroundColor: weekend ? 'rgba(26,26,26,0.025)' : '#FFFFFF' }}>
                    <div style={{ color: 'rgba(26,26,26,0.3)' }}>{DOW_ES[dow]}</div>
                    <div className="mx-auto w-5 h-5 flex items-center justify-center rounded-full text-[11px]" style={{ backgroundColor: isToday ? '#833B0E' : 'transparent', color: isToday ? '#FFFFFF' : 'rgba(26,26,26,0.6)' }}>{Number(d.slice(8))}</div>
                  </th>
                )
              })}
              <th className="px-2 py-2 text-right font-medium uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.35)', minWidth: 56, borderBottom: '1px solid rgba(26,26,26,0.06)' }}>Ocup.</th>
            </tr>
          </thead>
          <tbody>
            {units.map(u => (
              <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                <td className="sticky left-0 z-10 px-3 py-1 whitespace-nowrap" style={{ backgroundColor: '#FFFFFF', borderBottom: '1px solid rgba(26,26,26,0.05)', borderRight: '1px solid rgba(26,26,26,0.06)' }}>
                  <Link href={`/dashboard/${u.id}/calendar`} className="text-xs font-medium hover:underline" style={{ color: '#1A1A1A' }}>{u.name}</Link>
                </td>
                {u.cells.map((c, i) => {
                  const d = days[i]
                  const past = d < today
                  if (c.k === 'r') {
                    const cs = getChannelStyle(c.ch)
                    return (
                      <td key={d} className="p-0" style={{ borderBottom: '1px solid rgba(26,26,26,0.05)' }}>
                        <div
                          title={c.t}
                          className="h-8 mx-px flex items-center justify-center font-semibold overflow-hidden"
                          style={{
                            backgroundColor: cs.bg,
                            color: cs.text,
                            borderLeft: c.s ? `3px solid ${cs.border}` : 'none',
                            borderTopLeftRadius: c.s ? 6 : 0, borderBottomLeftRadius: c.s ? 6 : 0,
                            borderTopRightRadius: c.e ? 6 : 0, borderBottomRightRadius: c.e ? 6 : 0,
                            marginLeft: c.s ? 2 : 0, marginRight: c.e ? 2 : 0,
                          }}
                        >
                          {c.s ? c.ini : ''}
                        </div>
                      </td>
                    )
                  }
                  if (c.k === 'b') {
                    return (
                      <td key={d} className="p-0" style={{ borderBottom: '1px solid rgba(26,26,26,0.05)' }}>
                        <div title={c.t} className="h-8 mx-px flex items-center justify-center" style={{ backgroundColor: 'rgba(26,26,26,0.08)', backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 4px, rgba(26,26,26,0.06) 4px 8px)', color: 'rgba(26,26,26,0.4)' }}>×</div>
                      </td>
                    )
                  }
                  return (
                    <td key={d} className="p-0 text-center" style={{ borderBottom: '1px solid rgba(26,26,26,0.05)', backgroundColor: past ? '#F3F2F0' : '#FFFFFF' }}>
                      <div className="h-8 flex items-center justify-center" style={{ color: past ? 'rgba(26,26,26,0.2)' : 'rgba(214,167,0,0.9)' }}>
                        {c.p != null ? fmtPrice(c.p, currency) : ''}
                      </div>
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-right text-xs font-semibold" style={{ color: occColor(u.occupancy), borderBottom: '1px solid rgba(26,26,26,0.05)' }}>{u.occupancy}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="sticky left-0 z-10 px-3 py-2 text-[10px] uppercase tracking-widest font-medium" style={{ backgroundColor: '#FAF9F7', color: 'rgba(26,26,26,0.4)', borderTop: '1px solid rgba(26,26,26,0.08)', borderRight: '1px solid rgba(26,26,26,0.06)' }}>Edificio</td>
              {dailyOccupancy.map((pct, i) => (
                <td key={days[i]} className="p-0 text-center" style={{ backgroundColor: '#FAF9F7', borderTop: '1px solid rgba(26,26,26,0.08)' }}>
                  <div className="h-8 flex flex-col items-center justify-end pb-0.5" title={`${days[i]}: ${pct}% ocupado`}>
                    <div className="w-4 rounded-sm" style={{ height: `${Math.max(2, Math.round(pct * 0.2))}px`, backgroundColor: occColor(pct) }} />
                    <span className="text-[9px] font-semibold" style={{ color: 'rgba(26,26,26,0.5)' }}>{pct}</span>
                  </div>
                </td>
              ))}
              <td className="px-2 py-1 text-right text-xs font-semibold" style={{ backgroundColor: '#FAF9F7', color: occColor(monthOcc), borderTop: '1px solid rgba(26,26,26,0.08)' }}>{monthOcc}%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-6 py-3" style={{ borderTop: '1px solid rgba(26,26,26,0.06)' }}>
        {Object.values(CHANNEL_COLORS).map(s => (
          <div key={s.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.border }} />
            <span className="text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>{s.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: DEFAULT_CHANNEL.border }} />
          <span className="text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>Otro canal</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(26,26,26,0.15)' }} />
          <span className="text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>Bloqueo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold" style={{ color: 'rgba(214,167,0,0.9)' }}>$120</span>
          <span className="text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>Tarifa publicada (libre)</span>
        </div>
      </div>
    </div>
  )
}
