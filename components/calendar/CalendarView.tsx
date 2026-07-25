'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'

interface Reservation {
  id: string
  check_in: string
  check_out: string
  nights: number | null
  guest_name: string | null
  channel: string | null
  status: string
  num_guests: number | null
  owner_revenue: number | null
  currency: string | null
  total_price: number | null
}

interface PricingDay {
  calendar_date: string
  base_rate: number | null
  recommended_rate: number | null
  is_available: boolean
  is_blocked: boolean
  block_reason: string | null
  min_stay_nights: number | null
  currency: string | null
}

interface CalendarViewProps {
  propertyId: string
  year: number
  month: number
  reservations: Reservation[]
  pricing: PricingDay[]
}

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
const DAYS_ES   = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']

const CHANNEL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  airbnb:        { bg: 'rgba(239,68,68,0.15)',   border: '#ef4444', text: '#F20022' },
  'booking.com': { bg: 'rgba(59,130,246,0.15)',  border: '#0080C6', text: '#0080C6' },
  direct:        { bg: 'rgba(14,104,69,0.2)',    border: '#0E6845', text: '#0E6845' },
  vrbo:          { bg: 'rgba(139,92,246,0.15)',  border: '#4D439E', text: '#4D439E' },
}

const DEFAULT_CHANNEL = { bg: 'rgba(131, 59, 14,0.15)', border: '#833B0E', text: '#833B0E' }

function getChannelStyle(channel: string | null) {
  if (!channel) return DEFAULT_CHANNEL
  return CHANNEL_COLORS[channel.toLowerCase()] ?? DEFAULT_CHANNEL
}

function fmt(amount: number | null, currency = 'USD') {
  if (!amount) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

export default function CalendarView({ propertyId, year, month, reservations, pricing }: CalendarViewProps) {
  const router = useRouter()
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null)

  // Maps
  const pricingMap = new Map<string, PricingDay>()
  for (const p of pricing) pricingMap.set(p.calendar_date, p)

  const reservationMap = new Map<string, Reservation>()
  for (const r of reservations) {
    const checkIn  = new Date(r.check_in  + 'T00:00:00')
    const checkOut = new Date(r.check_out + 'T00:00:00')
    const current  = new Date(checkIn)
    while (current < checkOut) {
      reservationMap.set(current.toISOString().split('T')[0], r)
      current.setDate(current.getDate() + 1)
    }
  }

  // Grid
  const firstOfMonth = new Date(year, month - 1, 1)
  const lastOfMonth  = new Date(year, month, 0)
  const startPad     = firstOfMonth.getDay()
  const totalDays    = lastOfMonth.getDate()

  const cells: Array<{ date: string; day: number } | null> = []
  for (let i = 0; i < startPad; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ date: `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`, day: d })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  function navigate(delta: number) {
    let m = month + delta, y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    router.push(`/dashboard/${propertyId}/calendar?month=${m}&year=${y}`)
  }

  const today   = new Date().toISOString().split('T')[0]
  const monthPfx = `${year}-${String(month).padStart(2,'0')}-`

  const bookedDays   = [...reservationMap.keys()].filter(d => d.startsWith(monthPfx)).length
  const occupancy    = Math.round((bookedDays / totalDays) * 100)
  const monthRevenue = reservations
    .filter(r => r.check_in.startsWith(monthPfx))
    .reduce((s, r) => s + (r.owner_revenue ?? 0), 0)

  return (
    <div>
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Ocupación', value: `${occupancy}%`, sub: `${bookedDays}/${totalDays} días` },
          { label: 'Reservas', value: String(reservations.length), sub: 'este mes' },
          { label: 'Ingresos netos', value: fmt(monthRevenue) ?? '—', sub: 'propietario' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-5 nok-card">
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>{s.label}</p>
            <p className="font-serif text-3xl font-light text-[#1A1A1A]">{s.value}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(26,26,26,0.3)' }}>{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Calendar card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.07)' }}
      >
        {/* Month navigation */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}
        >
          <button
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer"
            style={{ color: 'rgba(26,26,26,0.45)', border: '1px solid rgba(26,26,26,0.07)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(131, 59, 14,0.5)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,26,26,0.07)'}
          >
            ‹
          </button>
          <h2 className="font-serif text-xl font-light text-[#1A1A1A]">
            {MONTHS_ES[month - 1]} {year}
          </h2>
          <button
            onClick={() => navigate(1)}
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer"
            style={{ color: 'rgba(26,26,26,0.45)', border: '1px solid rgba(26,26,26,0.07)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(131, 59, 14,0.5)'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,26,26,0.07)'}
          >
            ›
          </button>
        </div>

        {/* Day headers */}
        <div
          className="grid grid-cols-7"
          style={{ borderBottom: '1px solid rgba(26,26,26,0.05)' }}
        >
          {DAYS_ES.map(d => (
            <div key={d} className="py-3 text-center text-xs font-medium tracking-widest uppercase"
              style={{ color: 'rgba(26,26,26,0.25)' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            if (!cell) return (
              <div
                key={i}
                className="min-h-[88px]"
                style={{ borderRight: '1px solid rgba(26,26,26,0.04)', borderBottom: '1px solid rgba(26,26,26,0.04)', backgroundColor: '#E9E7E2' }}
              />
            )

            const { date, day } = cell
            const reservation  = reservationMap.get(date)
            const price        = pricingMap.get(date)
            const isToday      = date === today
            const isPast       = date < today
            const isCheckIn    = reservation?.check_in === date
            const channelStyle = reservation ? getChannelStyle(reservation.channel) : DEFAULT_CHANNEL

            return (
              <div
                key={date}
                onClick={() => reservation && setSelectedReservation(reservation)}
                className="min-h-[88px] p-1.5 flex flex-col transition-colors duration-150"
                style={{
                  borderRight: '1px solid rgba(26,26,26,0.04)',
                  borderBottom: '1px solid rgba(26,26,26,0.04)',
                  backgroundColor: reservation
                    ? `${channelStyle.bg}`
                    : isPast ? '#E9E7E2' : '#FFFFFF',
                  cursor: reservation ? 'pointer' : 'default',
                }}
                onMouseEnter={e => {
                  if (reservation)
                    (e.currentTarget as HTMLElement).style.filter = 'brightness(1.15)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.filter = 'none'
                }}
              >
                {/* Day number */}
                <div className="flex items-start justify-between mb-1">
                  <span
                    className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: isToday ? '#833B0E' : 'transparent',
                      color: isToday ? '#FFFFFF' : isPast ? 'rgba(26,26,26,0.2)' : 'rgba(26,26,26,0.6)',
                    }}
                  >
                    {day}
                  </span>
                  {isCheckIn && (
                    <span className="text-[9px] font-semibold px-1 py-0.5 rounded" style={{ color: '#0E6845', backgroundColor: 'rgba(74,222,128,0.1)' }}>IN</span>
                  )}
                  {reservation?.check_out === date && !isCheckIn && (
                    <span className="text-[9px] font-semibold px-1 py-0.5 rounded" style={{ color: '#F20022', backgroundColor: 'rgba(252,165,165,0.1)' }}>OUT</span>
                  )}
                </div>

                {/* Reservation bar */}
                {reservation && (
                  <div
                    className="rounded px-1.5 py-1 mb-1 flex-1"
                    style={{
                      borderLeft: `2px solid ${channelStyle.border}`,
                      backgroundColor: 'rgba(0,0,0,0.2)',
                    }}
                  >
                    <p className="text-[10px] font-medium truncate leading-tight" style={{ color: channelStyle.text }}>
                      {reservation.guest_name || 'Huésped'}
                    </p>
                    {isCheckIn && (
                      <>
                        <p className="text-[9px] leading-tight mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                          {reservation.nights}n · {reservation.channel ? reservation.channel.charAt(0).toUpperCase() + reservation.channel.slice(1) : ''}
                        </p>
                        {reservation.owner_revenue ? (
                          <p className="text-[9px] font-semibold leading-tight mt-0.5" style={{ color: '#0E6845' }}>
                            {fmt(reservation.owner_revenue, reservation.currency ?? 'USD')}
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                )}

                {/* Rate — show on available days */}
                {!reservation && price && !price.is_blocked && (
                  <div className="mt-auto">
                    {price.base_rate ? (
                      <p className="text-[10px] font-semibold" style={{ color: 'rgba(214,167,0,0.8)' }}>
                        {fmt(price.base_rate, price.currency ?? 'USD')}
                      </p>
                    ) : (
                      <p className="text-[9px]" style={{ color: 'rgba(26,26,26,0.2)' }}>
                        Disponible
                      </p>
                    )}
                    {price.min_stay_nights && price.min_stay_nights > 1 && (
                      <p className="text-[9px]" style={{ color: 'rgba(26,26,26,0.25)' }}>{price.min_stay_nights}n mín</p>
                    )}
                  </div>
                )}
                {/* No pricing data, no reservation — show available */}
                {!reservation && !price && !isPast && (
                  <div className="mt-auto">
                    <p className="text-[9px]" style={{ color: 'rgba(26,26,26,0.15)' }}>Disponible</p>
                  </div>
                )}

                {/* Blocked */}
                {!reservation && price?.is_blocked && (
                  <div className="rounded px-1 py-0.5 mt-auto" style={{ backgroundColor: 'rgba(26,26,26,0.05)' }}>
                    <p className="text-[9px]" style={{ color: 'rgba(26,26,26,0.25)' }}>Bloqueado</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
        <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.25)' }}>Canales:</p>
        {Object.entries(CHANNEL_COLORS).map(([channel, style]) => (
          <div key={channel} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: style.border }} />
            <span className="text-xs capitalize" style={{ color: 'rgba(26,26,26,0.4)' }}>{channel}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#833B0E' }} />
          <span className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>Otro</span>
        </div>
      </div>

      {/* Reservation list for the month */}
      {reservations.length > 0 && (
        <div className="mt-8">
          <h3 className="font-serif text-lg font-light text-[#1A1A1A] mb-4">
            Reservas del mes ({reservations.length})
          </h3>
          <div className="space-y-2">
            {[...reservations]
              .sort((a, b) => a.check_in.localeCompare(b.check_in))
              .map((r) => {
                const ch = getChannelStyle(r.channel)
                const checkInDate = new Date(r.check_in + 'T00:00:00')
                const checkOutDate = new Date(r.check_out + 'T00:00:00')
                const fmtDate = (d: Date) => d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' })
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedReservation(r)}
                    className="rounded-xl p-4 flex items-center gap-4 cursor-pointer transition-all duration-150 hover:scale-[1.01]"
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid rgba(26,26,26,0.07)',
                      borderLeft: `3px solid ${ch.border}`,
                    }}
                  >
                    {/* Guest + Channel */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#1A1A1A] truncate">
                        {r.guest_name || 'Huésped'}
                      </p>
                      <p className="text-xs mt-0.5 capitalize" style={{ color: ch.text }}>
                        {r.channel ?? 'Desconocido'}
                      </p>
                    </div>
                    {/* Dates */}
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[#1A1A1A]/60">
                        {fmtDate(checkInDate)} → {fmtDate(checkOutDate)}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'rgba(26,26,26,0.3)' }}>
                        {r.nights ?? '—'} noches · {r.num_guests ?? '—'} huéspedes
                      </p>
                    </div>
                    {/* Revenue */}
                    <div className="text-right shrink-0 ml-2">
                      {r.owner_revenue ? (
                        <p className="text-sm font-semibold" style={{ color: '#0E6845' }}>
                          {fmt(r.owner_revenue, r.currency ?? 'USD')}
                        </p>
                      ) : r.total_price ? (
                        <p className="text-sm font-medium text-[#1A1A1A]/60">
                          {fmt(r.total_price, r.currency ?? 'USD')}
                        </p>
                      ) : (
                        <p className="text-sm text-[#1A1A1A]/30">—</p>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Reservation detail modal */}
      {selectedReservation && (
        <div
          className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.12)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelectedReservation(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid rgba(131, 59, 14,0.3)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="font-serif text-2xl font-light text-[#1A1A1A]">
                  {selectedReservation.guest_name ?? 'Huésped'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: getChannelStyle(selectedReservation.channel).border }}
                  />
                  <p className="text-xs capitalize" style={{ color: 'rgba(26,26,26,0.4)' }}>
                    {selectedReservation.channel ?? 'Canal desconocido'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReservation(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer"
                style={{ color: 'rgba(26,26,26,0.4)', border: '1px solid rgba(26,26,26,0.08)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#1A1A1A'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.4)'}
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <ModalRow label="Check-in" value={new Date(selectedReservation.check_in + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })} />
              <ModalRow label="Check-out" value={new Date(selectedReservation.check_out + 'T00:00:00').toLocaleDateString('es-DO', { weekday: 'long', day: 'numeric', month: 'long' })} />
              <ModalRow label="Noches" value={String(selectedReservation.nights ?? '—')} />
              {selectedReservation.num_guests && <ModalRow label="Huéspedes" value={String(selectedReservation.num_guests)} />}
              {selectedReservation.total_price && (
                <ModalRow label="Precio total" value={fmt(selectedReservation.total_price, selectedReservation.currency ?? 'USD') ?? '—'} />
              )}
              {selectedReservation.owner_revenue && (
                <div
                  className="flex items-center justify-between pt-3 mt-1"
                  style={{ borderTop: '1px solid rgba(26,26,26,0.07)' }}
                >
                  <span className="text-sm font-medium text-[#1A1A1A]">Ingreso neto</span>
                  <span className="text-base font-semibold" style={{ color: '#0E6845' }}>
                    {fmt(selectedReservation.owner_revenue, selectedReservation.currency ?? 'USD')}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6">
              <Link
                href={`/dashboard/${propertyId}/reservations`}
                className="block text-center text-sm py-2.5 rounded-xl transition-all duration-200"
                style={{
                  color: '#833B0E',
                  border: '1px solid rgba(131, 59, 14,0.3)',
                  backgroundColor: 'rgba(131, 59, 14,0.08)',
                }}
                onClick={() => setSelectedReservation(null)}
              >
                Ver todas las reservas
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ModalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-sm shrink-0" style={{ color: 'rgba(26,26,26,0.4)' }}>{label}</span>
      <span className="text-sm font-medium text-[#1A1A1A] text-right">{value}</span>
    </div>
  )
}
