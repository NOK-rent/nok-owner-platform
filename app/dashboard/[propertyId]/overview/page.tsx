import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { copToUSD, getUSDtoCOPRate } from '@/lib/trm'
import SupportForm from '@/components/dashboard/SupportForm'
import MonthPills from '@/components/dashboard/MonthPills'
import { loadOwnerProperty } from '@/lib/admin'
import { sumMonthCostsUSD, sumRangeCostsUSD, type OwnerCostRow } from '@/lib/owner-costs'
import { getOperationsFacts } from '@/lib/operations-facts'

interface Props {
  params: Promise<{ propertyId: string }>
  searchParams: Promise<{ month?: string }>
}

function fmt(amount: number | null, currency = 'USD') {
  if (amount === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function fmtPct(val: number | null) {
  if (val === null) return '—'
  return `${val.toFixed(1)}%`
}

function prorateForMonth(ownerRevenue: number, nights: number, checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  if (nights <= 0 || ownerRevenue <= 0) return 0
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1) // monthEnd is inclusive

  const overlapStart = ci > ms ? ci : ms
  const overlapEnd = co < me ? co : me
  const overlapDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000*60*60*24)))

  if (overlapDays >= nights) return ownerRevenue
  return (ownerRevenue / nights) * overlapDays
}

function overlapNightsForMonth(checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1) // monthEnd is inclusive

  const overlapStart = ci > ms ? ci : ms
  const overlapEnd = co < me ? co : me
  return Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000*60*60*24)))
}

export default async function OverviewPage({ params, searchParams }: Props) {
  const { propertyId } = await params
  const { month: monthParam } = await searchParams

  const { owner, property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  // Derive building name from property.name (e.g. "The Park IV 301" → "The Park IV")
  const propBuilding = (property.name || '').replace(/\s+\S+$/, '').trim() || property.name || ''
  const maintOr = `property_id.eq.${propertyId},building.eq.${propBuilding}`

  const now       = new Date()
  // Selected month (from ?month=YYYY-MM) or current month
  const selectedMonthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [selYear, selMonth] = selectedMonthKey.split('-').map(Number)
  const displayYear = now.getFullYear()
  const yearStart = `${displayYear}-01-01`
  const monthStart = `${selectedMonthKey}-01`
  const monthEnd   = `${selectedMonthKey}-${String(new Date(selYear, selMonth, 0).getDate()).padStart(2, '0')}`
  const selectedMonthDate = new Date(selYear, selMonth - 1, 1)
  const daysInSelectedMonth = new Date(selYear, selMonth, 0).getDate()

  // Also compute trailing 12 months for properties that may not have current-month data
  const twelveMonthsAgo = new Date(now)
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)
  const trailing12Start = twelveMonthsAgo.toISOString().split('T')[0]

  // YTD list of months (e.g. 2026-01..2026-04)
  const ytdMonthKeys: string[] = []
  for (let m = 1; m <= now.getMonth() + 1; m++) {
    ytdMonthKeys.push(`${displayYear}-${String(m).padStart(2, '0')}`)
  }

  const [cleaningsRes, upcomingRes, channelRes, checkoutsRes, monthResRes, ytdResRes, trailing12Res, monthUtilRes, ytdUtilRes, monthMaintRes, ytdMaintRes, ownerCostsRes] = await Promise.all([
    sb.from('cleaning_records').select('completed_at, staff_name, status')
      .eq('property_id', propertyId).eq('status', 'completed')
      .order('completed_at', { ascending: false }).limit(1).single(),
    sb.from('reservations').select('check_in, check_out, guest_name, channel, nights')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', new Date().toISOString().split('T')[0])
      .order('check_in', { ascending: true }).limit(5),
    sb.from('reservations').select('channel, owner_revenue, currency')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out']).gte('check_in', yearStart),
    sb.from('reservations').select('check_in, check_out')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', monthEnd).gte('check_out', monthStart),
    sb.from('reservations').select('owner_revenue, nights, currency, check_in, check_out, channel')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', monthEnd).gt('check_out', monthStart),
    // Year-to-date reservations for YTD metrics
    sb.from('reservations').select('owner_revenue, nights, currency, check_in, check_out, channel')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', yearStart),
    // Trailing 12 months for occupancy calculation
    sb.from('reservations').select('nights, check_in, check_out')
      .eq('property_id', propertyId).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', trailing12Start),
    // Utility costs for selected month
    sb.from('utility_costs').select('utility_type, amount, currency, month, reference')
      .eq('property_id', propertyId).eq('month', selectedMonthKey),
    // Utility costs YTD
    sb.from('utility_costs').select('utility_type, amount, currency, month')
      .eq('property_id', propertyId).in('month', ytdMonthKeys),
    // Maintenance costs for selected month
    sb.from('maintenance_costs').select('amount, currency, date, type, description, property_id, building')
      .or(maintOr).gte('date', monthStart).lte('date', monthEnd),
    // Maintenance costs YTD
    sb.from('maintenance_costs').select('amount, currency, date, property_id, building')
      .or(maintOr).gte('date', yearStart),
    // Owner-entered direct costs (mortgage, HOA, etc.)
    // Wrap in a catch so the page still renders if the migration hasn't been applied yet.
    sb.from('owner_costs').select('*').eq('property_id', propertyId).then(
      (r: any) => r,
      () => ({ data: [], error: null }),
    ),
  ])

  // Live TRM (cached 24h) — used to convert any COP reservation to USD
  const trm = await getUSDtoCOPRate()
  const toUSD = (amount: number, currency: string | null | undefined) =>
    (currency || 'USD').toUpperCase() === 'COP' ? amount / trm : amount

  const lastCleaning        = cleaningsRes.data
  const upcomingReservations = upcomingRes.data ?? []

  // ── Ingresos ya confirmados — próximos 12 meses ─────────────
  const todayIso = now.toISOString().split('T')[0]
  const in12mIso = new Date(now.getTime() + 365 * 86400000).toISOString().split('T')[0]
  const { data: next12mRes } = await sb
    .from('reservations')
    .select('owner_revenue, currency, nights, check_in')
    .eq('property_id', propertyId)
    .in('status', ['confirmed', 'checked_in'])
    .gte('check_in', todayIso)
    .lt('check_in', in12mIso)
  const next12m = next12mRes ?? []
  const next12mRevenue = next12m.reduce((s: number, r: any) => s + toUSD(r.owner_revenue ?? 0, r.currency), 0)
  const next12mNights = next12m.reduce((s: number, r: any) => s + (r.nights ?? 0), 0)
  const next12mNetEstimate = next12mRevenue * (1 - (property.nok_commission_rate ?? 0) / 100)

  // ── Current month metrics (prorated) ──────────────────────────
  const monthReservations = monthResRes.data ?? []
  const totalBookedNights = monthReservations.reduce((s: number, r: any) =>
    s + overlapNightsForMonth(r.check_in, r.check_out, monthStart, monthEnd), 0)
  const daysInMonth = daysInSelectedMonth
  const occupancyRate = daysInMonth > 0 ? Math.round((totalBookedNights / daysInMonth) * 100) : 0

  const checkoutReservations = checkoutsRes.data ?? []
  const checkoutsThisMonth = checkoutReservations.filter((r: any) => {
    const co = r.check_out
    return co >= monthStart && co <= monthEnd
  }).length

  // ── Year-to-date metrics ──────────────────────────────────────
  const ytdReservations = ytdResRes.data ?? []
  const ytdRevenue = ytdReservations.reduce((s: number, r: any) => s + toUSD(r.owner_revenue ?? 0, r.currency), 0)
  const ytdNights = ytdReservations.reduce((s: number, r: any) => s + (r.nights ?? 0), 0)
  const ytdAdr = ytdNights > 0 ? Math.round(ytdRevenue / ytdNights) : 0

  // Trailing 12m occupancy
  const trailing12 = trailing12Res.data ?? []
  const trailing12Nights = trailing12.reduce((s: number, r: any) => s + (r.nights ?? 0), 0)
  const trailing12Occupancy = Math.round((trailing12Nights / 365) * 100)

  // Channel breakdown (year to date)
  const channelMap: Record<string, { count: number; revenue: number }> = {}
  for (const r of channelRes.data ?? []) {
    const ch = r.channel ?? 'Otro'
    if (!channelMap[ch]) channelMap[ch] = { count: 0, revenue: 0 }
    channelMap[ch].count++
    channelMap[ch].revenue += toUSD(r.owner_revenue ?? 0, r.currency)
  }
  const channels = Object.entries(channelMap).sort((a, b) => b[1].revenue - a[1].revenue)
  const totalRevenue = channels.reduce((s, [, v]) => s + v.revenue, 0)

  const CHANNEL_COLORS: Record<string, string> = {
    airbnb2: '#ef4444',
    Airbnb: '#ef4444',
    'booking.com': '#0080C6',
    'Booking.com': '#0080C6',
    Direct: '#0E6845',
    direct: '#0E6845',
    Vrbo: '#4D439E',
    owner: '#D6A700',
  }

  // Financial summary — current month with proration
  const grossRevenue   = monthReservations.reduce((s: number, r: any) =>
    s + prorateForMonth(toUSD(r.owner_revenue ?? 0, r.currency), r.nights ?? 0, r.check_in, r.check_out, monthStart, monthEnd), 0)
  const avgDailyRate   = totalBookedNights > 0 ? Math.round(grossRevenue / totalBookedNights) : 0
  const commRate       = (property.nok_commission_rate ?? 0) / 100
  const commAmount     = grossRevenue * commRate
  const checkouts      = checkoutsThisMonth
  let cleaningCostUSD  = 0
  if (property.cleaning_fee && checkouts > 0) {
    const raw = property.cleaning_fee as number
    cleaningCostUSD = property.cleaning_fee_currency === 'COP'
      ? await copToUSD(raw * checkouts)
      : raw * checkouts
  }

  // ── Direct booking commission (10% on direct/owner reservations) ──
  const DIRECT_RATE = 0.10
  function isDirect(ch: string | null | undefined) {
    const c = (ch ?? '').toLowerCase()
    return c.includes('direct') || c === 'owner' || c === 'manual' || c.includes('website')
  }
  const directBookingCommission = monthReservations.reduce((s: number, r: any) => {
    if (!isDirect(r.channel)) return s
    const pr = prorateForMonth(toUSD(r.owner_revenue ?? 0, r.currency), r.nights ?? 0, r.check_in, r.check_out, monthStart, monthEnd)
    return s + (pr > 0 ? pr * DIRECT_RATE : 0)
  }, 0)

  // ── Utilities for current month ──
  const monthUtilRows = monthUtilRes.data ?? []
  const utilitiesByType: Record<string, { amount: number; currency: string; reference?: string }[]> = {}
  let monthUtilitiesUSD = 0
  for (const u of monthUtilRows as any[]) {
    const amt = Number(u.amount) || 0
    const usd = (u.currency || 'COP').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
    monthUtilitiesUSD += usd
    if (!utilitiesByType[u.utility_type]) utilitiesByType[u.utility_type] = []
    utilitiesByType[u.utility_type].push({ amount: amt, currency: u.currency, reference: u.reference })
  }

  // ── Maintenance for current month ──
  const monthMaintRows = (monthMaintRes as any)?.data ?? []
  let monthMaintenanceUSD = 0
  for (const m of monthMaintRows as any[]) {
    const amt = Number(m.amount) || 0
    const usd = (m.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
    monthMaintenanceUSD += usd
  }

  // ── Owner-entered direct costs ──
  const ownerCostRows = ((ownerCostsRes as any)?.data ?? []) as OwnerCostRow[]
  const monthStartDate = new Date(monthStart + 'T00:00:00')
  const monthEndDate = new Date(monthEnd + 'T00:00:00')
  const yearStartDate = new Date(yearStart + 'T00:00:00')
  const ownerCostsMonthUSD = sumMonthCostsUSD(ownerCostRows, monthStartDate, monthEndDate, toUSD)
  const ownerCostsYtdUSD = sumRangeCostsUSD(ownerCostRows, yearStartDate, monthEndDate, toUSD)

  // Operations facts del mes (mensajes respondidos, limpiezas, camas tendidas)
  const opsFacts = await getOperationsFacts(sb, property, selectedMonthKey, checkouts)

  const netRevenue = grossRevenue - commAmount - cleaningCostUSD - directBookingCommission - monthUtilitiesUSD - monthMaintenanceUSD - ownerCostsMonthUSD

  // YTD financial
  const ytdCommAmount = ytdRevenue * commRate
  // Count YTD checkouts
  const ytdCheckouts = ytdReservations.length
  let ytdCleaningCost = 0
  if (property.cleaning_fee && ytdCheckouts > 0) {
    const raw = property.cleaning_fee as number
    ytdCleaningCost = property.cleaning_fee_currency === 'COP'
      ? await copToUSD(raw * ytdCheckouts)
      : raw * ytdCheckouts
  }

  // YTD direct booking commission
  const ytdDirectCommission = ytdReservations.reduce((s: number, r: any) => {
    if (!isDirect(r.channel)) return s
    return s + (toUSD(r.owner_revenue ?? 0, r.currency) * DIRECT_RATE)
  }, 0)

  // YTD utilities
  const ytdUtilRows = ytdUtilRes.data ?? []
  let ytdUtilitiesUSD = 0
  for (const u of ytdUtilRows as any[]) {
    const amt = Number(u.amount) || 0
    const usd = (u.currency || 'COP').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
    ytdUtilitiesUSD += usd
  }

  // YTD maintenance
  const ytdMaintRows = (ytdMaintRes as any)?.data ?? []
  let ytdMaintenanceUSD = 0
  for (const m of ytdMaintRows as any[]) {
    const amt = Number(m.amount) || 0
    const usd = (m.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
    ytdMaintenanceUSD += usd
  }

  const ytdNetRevenue = ytdRevenue - ytdCommAmount - ytdCleaningCost - ytdDirectCommission - ytdUtilitiesUSD - ytdMaintenanceUSD - ownerCostsYtdUSD

  const hasFinancialData   = property.nok_commission_rate != null || property.cleaning_fee != null
  const ownerFirstName     = (owner as any).name?.split(' ')[0] ?? 'Propietario'

  return (
    <div style={{ backgroundColor: '#F0EFED' }}>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section
        className="hero-shimmer relative overflow-hidden px-8 lg:px-16 flex flex-col justify-center"
        style={{ minHeight: '280px', paddingTop: '48px', paddingBottom: '48px' }}
      >
        {/* Subtle bottom fade */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #F0EFED)' }}
        />

        <div className="relative z-10">
          <p
            className="text-xs uppercase tracking-[0.2em] mb-4 fade-up"
            style={{ color: 'rgba(185,181,220,0.7)' }}
          >
            NOK Owners &nbsp;·&nbsp; Feels right. Anywhere.
          </p>
          <h1
            className="font-serif text-5xl lg:text-6xl font-light text-[#F2F2F2] mb-3 fade-up-delay-1"
          >
            Hola, {ownerFirstName}.
          </h1>
          <p
            className="text-base mb-10 fade-up-delay-1"
            style={{ color: 'rgba(255,255,255,0.6)' }}
          >
            Here&apos;s what&apos;s happening with {property.name} today.
          </p>

          {/* Stat pills — current month (prorated) */}
          <div className="flex flex-wrap gap-3 fade-up-delay-2">
            <StatPill
              label="Ingresos del mes"
              value={fmt(grossRevenue)}
            />
            <StatPill
              label="Ocupación"
              value={fmtPct(occupancyRate)}
            />
            <StatPill
              label="Noches reservadas"
              value={String(totalBookedNights)}
            />
            <StatPill
              label="ADR mes"
              value={avgDailyRate > 0 ? fmt(avgDailyRate) : '—'}
            />
          </div>
        </div>
      </section>

      {/* ── Content ───────────────────────────────────────────────── */}
      <div className="px-8 lg:px-16 py-10 max-w-6xl space-y-6">

        {/* Comunicados del equipo NOK */}

        {/* Month selector */}
        <div className="rounded-2xl p-5 nok-card">
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
            Filtrar por mes — {displayYear}
          </p>
          <MonthPills year={displayYear} selected={selectedMonthKey} />
        </div>

        {/* Current month metrics (prorated) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Ingresos del mes" value={fmt(grossRevenue)} sub={`${monthReservations.length} reservas`} />
          <MetricCard label="Ocupación del mes" value={fmtPct(occupancyRate)} sub="mes en curso" />
          <MetricCard label="Tarifa promedio" value={avgDailyRate > 0 ? fmt(avgDailyRate) : '—'} sub="por noche" />
          <MetricCard label="Noches reservadas" value={String(totalBookedNights)} sub={`de ${daysInMonth} días`} />
        </div>

        {/* Financial summary — current month (prorated) */}
        {(hasFinancialData || grossRevenue > 0) && (
          <div className="rounded-2xl p-6 nok-card">
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-6">
              Resumen financiero —{' '}
              {selectedMonthDate.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })}
            </h2>
            <div className="space-y-4">
              <FinRow label="Ingresos después de comisiones de canal" value={fmt(grossRevenue)} accent={false} />
              {property.nok_commission_rate != null && (
                <FinRow
                  label={`Comisión NOK (${property.nok_commission_rate}%)`}
                  value={`− ${fmt(commAmount)}`}
                  deduct
                />
              )}
              {property.cleaning_fee != null && (
                <FinRow
                  label={`Limpieza (${checkouts} checkout${checkouts !== 1 ? 's' : ''})`}
                  value={`− ${fmt(cleaningCostUSD)}`}
                  deduct
                />
              )}
              {directBookingCommission > 0 && (
                <FinRow
                  label="Comisión Reserva Directa (10%)"
                  value={`− ${fmt(directBookingCommission)}`}
                  deduct
                />
              )}
              {monthUtilitiesUSD > 0 && (
                <FinRow
                  label="Utilities (servicios públicos)"
                  value={`− ${fmt(monthUtilitiesUSD)}`}
                  deduct
                />
              )}
              {monthMaintenanceUSD > 0 && (
                <FinRow
                  label="Mantenimiento"
                  value={`− ${fmt(monthMaintenanceUSD)}`}
                  deduct
                />
              )}
              {ownerCostsMonthUSD > 0 && (
                <FinRow
                  label="Costos propios (ingresados por ti)"
                  value={`− ${fmt(ownerCostsMonthUSD)}`}
                  deduct
                />
              )}
              <div
                className="pt-4 mt-1"
                style={{ borderTop: '1px solid rgba(26,26,26,0.07)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#1A1A1A] font-medium">Ingreso neto propietario</span>
                  <span className="text-xl font-semibold" style={{ color: '#0E6845' }}>{fmt(netRevenue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Utilities breakdown — current month */}
        {Object.keys(utilitiesByType).length > 0 && (
          <div className="rounded-2xl p-6 nok-card">
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-2">
              Servicios públicos —{' '}
              {selectedMonthDate.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })}
            </h2>
            <p className="text-xs mb-5" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Detalle de cada utility pagado este mes para tu apartamento
            </p>
            <div className="space-y-3">
              {Object.entries(utilitiesByType).map(([type, items]) => {
                const totalCop = items.filter(i => (i.currency || 'COP').toUpperCase() === 'COP').reduce((s, i) => s + i.amount, 0)
                const totalUsd = items.filter(i => (i.currency || 'COP').toUpperCase() === 'USD').reduce((s, i) => s + i.amount, 0)
                return (
                  <div key={type} className="flex items-center justify-between py-2"
                    style={{ borderBottom: '1px solid rgba(26,26,26,0.05)' }}>
                    <div>
                      <p className="text-sm font-medium text-[#1A1A1A]">{type}</p>
                      {items[0]?.reference && (
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.35)' }}>
                          Cuenta: {items[0].reference}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      {totalCop > 0 && (
                        <p className="text-sm text-[#1A1A1A] tabular-nums">
                          {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(totalCop)}
                        </p>
                      )}
                      {totalUsd > 0 && (
                        <p className="text-sm text-[#1A1A1A] tabular-nums">{fmt(totalUsd)}</p>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="pt-3 flex items-center justify-between">
                <span className="text-sm font-medium" style={{ color: 'rgba(26,26,26,0.7)' }}>
                  Total servicios (USD)
                </span>
                <span className="text-base font-semibold" style={{ color: '#0E6845' }}>
                  {fmt(monthUtilitiesUSD)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* YTD Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label={`Ingresos YTD ${now.getFullYear()}`} value={fmt(ytdRevenue)} sub={`${ytdReservations.length} reservas`} />
          <MetricCard label="Ocupación 12 meses" value={fmtPct(trailing12Occupancy)} sub={`${trailing12Nights} noches`} />
          <MetricCard label="ADR YTD" value={ytdAdr > 0 ? fmt(ytdAdr) : '—'} sub="tarifa promedio neta" />
          <MetricCard label="Reservas YTD" value={String(ytdReservations.length)} sub={`${ytdNights} noches totales`} />
        </div>

        {/* Operación del mes */}
        <div>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
            Operación del mes — {selectedMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })}
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {opsFacts.mensajes != null && (
              <MetricCard label="Mensajes respondidos" value={String(opsFacts.mensajes)} sub="respuestas de NOK a tus huéspedes" />
            )}
            <MetricCard label="Limpiezas realizadas" value={String(opsFacts.limpiezas)} sub="en tu apartamento este mes" />
            <MetricCard
              label="Camas tendidas"
              value={String(opsFacts.camas)}
              sub={`${property.bedrooms ?? 0} habitaciones × ${checkouts} check-outs`}
            />
          </div>
        </div>

        {/* Ingresos confirmados — próximos 12 meses */}
        <div className="rounded-2xl p-6 md:p-8" style={{ backgroundColor: '#1A1A1A' }}>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Ingresos ya confirmados · próximos 12 meses
              </p>
              <p className="font-serif text-5xl font-light text-white leading-none">{fmt(next12mRevenue)}</p>
              <p className="text-xs mt-3" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {next12m.length} reservas confirmadas · {next12mNights} noches ya vendidas
              </p>
            </div>
            <div className="text-right">
              {property.nok_commission_rate != null && next12mRevenue > 0 && (
                <>
                  <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Neto estimado después de comisión NOK
                  </p>
                  <p className="font-serif text-3xl font-light" style={{ color: '#7FD1A7' }}>{fmt(next12mNetEstimate)}</p>
                </>
              )}
            </div>
          </div>
          <p className="text-[11px] mt-4" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Solo reservas ya confirmadas en el calendario — este número crece cada semana a medida que entran nuevas reservas. No incluye limpiezas, servicios ni otros descuentos del reporte mensual.
          </p>
        </div>

        {/* Financial summary — YTD */}
        {(hasFinancialData || ytdRevenue > 0) && (
          <div className="rounded-2xl p-6 nok-card">
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-6">
              Resumen financiero — YTD {now.getFullYear()}
            </h2>
            <div className="space-y-4">
              <FinRow label="Ingresos después de comisiones de canal" value={fmt(ytdRevenue)} accent={false} />
              {property.nok_commission_rate != null && (
                <FinRow
                  label={`Comisión NOK (${property.nok_commission_rate}%)`}
                  value={`− ${fmt(ytdCommAmount)}`}
                  deduct
                />
              )}
              {property.cleaning_fee != null && (
                <FinRow
                  label={`Limpieza (${ytdCheckouts} checkout${ytdCheckouts !== 1 ? 's' : ''})`}
                  value={`− ${fmt(ytdCleaningCost)}`}
                  deduct
                />
              )}
              {ytdDirectCommission > 0 && (
                <FinRow
                  label="Comisión Reserva Directa (10%)"
                  value={`− ${fmt(ytdDirectCommission)}`}
                  deduct
                />
              )}
              {ytdUtilitiesUSD > 0 && (
                <FinRow
                  label="Utilities (servicios públicos)"
                  value={`− ${fmt(ytdUtilitiesUSD)}`}
                  deduct
                />
              )}
              {ytdMaintenanceUSD > 0 && (
                <FinRow
                  label="Mantenimiento"
                  value={`− ${fmt(ytdMaintenanceUSD)}`}
                  deduct
                />
              )}
              {ownerCostsYtdUSD > 0 && (
                <FinRow
                  label="Costos propios (ingresados por ti)"
                  value={`− ${fmt(ownerCostsYtdUSD)}`}
                  deduct
                />
              )}
              <div
                className="pt-4 mt-1"
                style={{ borderTop: '1px solid rgba(26,26,26,0.07)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[#1A1A1A] font-medium">Ingreso neto propietario YTD</span>
                  <span className="text-xl font-semibold" style={{ color: '#0E6845' }}>{fmt(ytdNetRevenue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reviews section removed — metrics table not populated */}

        {/* Channel breakdown */}
        {channels.length > 0 && (
          <div className="rounded-2xl p-6 nok-card">
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-6">
              Origen de reservas — {now.getFullYear()}
            </h2>
            <div className="space-y-4">
              {channels.map(([channel, data]) => {
                const pct   = totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0
                const color = CHANNEL_COLORS[channel] ?? '#6b7280'
                return (
                  <div key={channel}>
                    <div className="flex items-center justify-between text-sm mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="font-medium text-[#1A1A1A]">{channel}</span>
                      </div>
                      <span style={{ color: 'rgba(26,26,26,0.45)' }}>
                        {data.count} reservas · {fmt(data.revenue)}
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct.toFixed(1)}%`, backgroundColor: color, opacity: 0.8 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Upcoming + Operations row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Upcoming reservations */}
          <div className="rounded-2xl p-6 nok-card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-2xl font-light text-[#1A1A1A]">Próximas reservas</h2>
              <Link
                href={`/dashboard/${propertyId}/reservations`}
                className="text-xs transition-colors duration-200"
                style={{ color: '#833B0E' }}
                onMouseEnter={undefined}
              >
                Ver todas →
              </Link>
            </div>
            {upcomingReservations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
                  style={{ backgroundColor: 'rgba(131, 59, 14,0.1)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(131,59,14,0.5)" strokeWidth="1.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </div>
                <p className="text-sm" style={{ color: 'rgba(26,26,26,0.3)' }}>No hay reservas próximas</p>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingReservations.map((r: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 first:pt-0"
                    style={{ borderBottom: i < upcomingReservations.length - 1 ? '1px solid rgba(26,26,26,0.05)' : 'none' }}
                  >
                    <div>
                      <p className="text-sm font-medium text-[#1A1A1A]">{r.guest_name ?? 'Huésped'}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                        {new Date(r.check_in).toLocaleDateString('es-DO', { month: 'short', day: 'numeric' })}
                        {' — '}
                        {new Date(r.check_out).toLocaleDateString('es-DO', { month: 'short', day: 'numeric' })}
                        {r.nights ? ` · ${r.nights} noches` : ''}
                      </p>
                    </div>
                    {r.channel && (
                      <span
                        className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={{
                          backgroundColor: `${CHANNEL_COLORS[r.channel] ?? '#6b7280'}18`,
                          color: CHANNEL_COLORS[r.channel] ?? 'rgba(26,26,26,0.5)',
                          border: `1px solid ${CHANNEL_COLORS[r.channel] ?? '#6b7280'}35`,
                        }}
                      >
                        {r.channel}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Operations */}
          <div className="rounded-2xl p-6 nok-card">
            <h2 className="font-serif text-2xl font-light text-[#1A1A1A] mb-6">Estado operativo</h2>
            <div className="space-y-4">
              <OpRow
                label="Última limpieza"
                value={lastCleaning?.completed_at
                  ? new Date(lastCleaning.completed_at).toLocaleDateString('es-DO', { month: 'short', day: 'numeric' })
                  : 'Sin datos'}
              />
              {lastCleaning?.staff_name && (
                <OpRow label="Limpiadora" value={lastCleaning.staff_name} />
              )}
              <OpRow
                label="Reservas del mes"
                value={String(monthReservations.length)}
              />
              <OpRow
                label={`Reservas YTD ${now.getFullYear()}`}
                value={String(ytdReservations.length)}
              />
              {property.nok_commission_rate != null && (
                <OpRow label="Comisión NOK" value={`${property.nok_commission_rate}%`} />
              )}
              {property.country && (
                <OpRow label="Mercado" value={property.country} />
              )}
            </div>
          </div>
        </div>

        {/* Support form */}
        <SupportForm propertyId={propertyId} />

        {/* NOK AI banner */}
        <div className="ai-banner-shimmer rounded-2xl p-7 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <h3 className="font-semibold text-white text-sm">NOK AI está optimizando tus propiedades</h3>
            </div>
            <p className="text-sm mb-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Precios dinámicos, respuestas automáticas y reportes inteligentes activos en tiempo real
            </p>
            <div className="flex flex-wrap gap-2">
              {['Precio dinámico ✓', 'Auto-respuestas ✓', 'Reportes AI ✓'].map(badge => (
                <span
                  key={badge}
                  className="text-xs px-3 py-1 rounded-full font-medium"
                  style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)' }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>
          <Link
            href={`/dashboard/${propertyId}/chat`}
            className="shrink-0 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 whitespace-nowrap"
            style={{
              backgroundColor: 'rgba(255,255,255,0.95)',
              color: '#833B0E',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            }}
          >
            Abrir NOK AI →
          </Link>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between py-6 text-xs"
          style={{
            borderTop: '1px solid rgba(26,26,26,0.06)',
            color: 'rgba(26,26,26,0.2)',
          }}
        >
          <span className="font-serif text-sm tracking-[0.2em]">NOK</span>
          <span>Curated stays designed to flow with you · <a href="https://nok.rent" target="_blank" rel="noopener" className="hover:text-[#833B0E] transition-colors">nok.rent</a></span>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center gap-4 px-5 py-3 rounded-xl"
      style={{
        backgroundColor: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(131, 59, 14,0.3)',
        borderLeft: '3px solid #833B0E',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div>
        <p className="text-xl font-semibold text-[#1A1A1A] leading-none">{value}</p>
        <p className="text-xs mt-1" style={{ color: 'rgba(26,26,26,0.45)' }}>{label}</p>
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-2xl p-5 nok-card"
    >
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(26,26,26,0.35)' }}>{label}</p>
      <p className="font-serif text-4xl font-light text-[#1A1A1A] leading-none">{value}</p>
      {sub && <p className="text-xs mt-2" style={{ color: 'rgba(26,26,26,0.3)' }}>{sub}</p>}
    </div>
  )
}

function FinRow({ label, value, deduct = false, accent = false }: {
  label: string
  value: string
  deduct?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: 'rgba(26,26,26,0.55)' }}>{label}</span>
      <span style={{ color: deduct ? '#DC2626' : accent ? '#0E6845' : '#1A1A1A' }}>
        {value}
      </span>
    </div>
  )
}

function ReviewCard({ platform, score, count, color }: {
  platform: string; score: number; count: number | null; color: string
}) {
  return (
    <div className="rounded-2xl p-5 nok-card flex items-center gap-5">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-xl"
        style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
      >
        ⭐
      </div>
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{platform}</p>
        <p className="font-serif text-3xl font-light text-[#1A1A1A]">{score.toFixed(2)}</p>
        {count && <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.3)' }}>{count} reseñas</p>}
      </div>
    </div>
  )
}

function OpRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between py-3 text-sm"
      style={{ borderBottom: '1px solid rgba(26,26,26,0.04)' }}
    >
      <span style={{ color: 'rgba(26,26,26,0.45)' }}>{label}</span>
      <span className="font-medium text-[#1A1A1A]">{value}</span>
    </div>
  )
}
