/**
 * Monthly statement — shared calculation for the "Cálculos" tab and its PDF.
 *
 * Mirrors the overview financial summary formula (see
 * app/dashboard/[propertyId]/overview/page.tsx) but splits the result in two:
 *   nokNet   = gross − NOK commission − cleaning − direct commission − utilities − maintenance
 *   finalNet = nokNet − owner-entered expenses (owner_costs)
 * so the owner can see the NOK report first and layer their own costs on top.
 */

import { copToUSD, getUSDtoCOPRate, getUSDtoDOPRate } from '@/lib/trm'
import { costAmountForMonth, type OwnerCostRow } from '@/lib/owner-costs'

export interface OwnerExpenseLine {
  id: string
  label: string
  category: string | null
  frequency: 'monthly' | 'one_time'
  amountOriginal: number
  currency: string
  amountUSD: number
  notes: string | null
}

export interface MonthlyStatement {
  monthKey: string // YYYY-MM
  propertyName: string
  currencyNote: string
  // Activity
  nights: number
  occupancyPct: number
  adr: number
  reservationsCount: number
  checkouts: number
  // NOK report
  gross: number
  commissionRate: number
  nokCommission: number
  cleaning: number
  directCommission: number
  utilities: number
  maintenance: number
  nokNet: number
  // Owner side
  ownerExpenses: OwnerExpenseLine[]
  ownerExpensesTotal: number
  finalNet: number
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
  const overlapDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)))

  if (overlapDays >= nights) return ownerRevenue
  return (ownerRevenue / nights) * overlapDays
}

function overlapNightsForMonth(checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1)

  const overlapStart = ci > ms ? ci : ms
  const overlapEnd = co < me ? co : me
  return Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000 * 60 * 60 * 24)))
}

function isDirect(ch: string | null | undefined) {
  const c = (ch ?? '').toLowerCase()
  return c.includes('direct') || c === 'owner' || c === 'manual' || c.includes('website')
}

const DIRECT_RATE = 0.10

export async function getMonthlyStatement(sb: any, property: any, monthKey: string): Promise<MonthlyStatement> {
  const [selYear, selMonth] = monthKey.split('-').map(Number)
  const monthStart = `${monthKey}-01`
  const monthEnd = `${monthKey}-${String(new Date(selYear, selMonth, 0).getDate()).padStart(2, '0')}`
  const daysInMonth = new Date(selYear, selMonth, 0).getDate()

  // Mantenimiento: SOLO de esta unidad. NO derivar el edificio del nombre — eso
  // cruzaba costos de otras unidades del mismo building entre owners distintos.
  const [monthResRes, checkoutsRes, monthUtilRes, monthMaintRes, ownerCostsRes, trm, trmDop] = await Promise.all([
    sb.from('reservations').select('owner_revenue, nights, currency, check_in, check_out, channel')
      .eq('property_id', property.id).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', monthEnd).gt('check_out', monthStart),
    sb.from('reservations').select('check_in, check_out')
      .eq('property_id', property.id).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', monthEnd).gte('check_out', monthStart),
    sb.from('utility_costs').select('utility_type, amount, currency, month')
      .eq('property_id', property.id).eq('month', monthKey),
    sb.from('maintenance_costs').select('amount, currency, date, property_id, building')
      .eq('property_id', property.id).gte('date', monthStart).lte('date', monthEnd),
    sb.from('owner_costs').select('*').eq('property_id', property.id).then(
      (r: any) => r,
      () => ({ data: [], error: null }),
    ),
    getUSDtoCOPRate(),
    getUSDtoDOPRate(),
  ])

  const toUSD = (amount: number, currency: string | null | undefined) => {
    const c = (currency || 'USD').toUpperCase()
    if (c === 'COP') return amount / trm
    if (c === 'DOP') return amount / trmDop
    return amount
  }

  const monthReservations = monthResRes.data ?? []
  const totalBookedNights = monthReservations.reduce((s: number, r: any) =>
    s + overlapNightsForMonth(r.check_in, r.check_out, monthStart, monthEnd), 0)
  const occupancyPct = daysInMonth > 0 ? Math.round((totalBookedNights / daysInMonth) * 100) : 0

  const checkouts = (checkoutsRes.data ?? []).filter((r: any) =>
    r.check_out >= monthStart && r.check_out <= monthEnd).length

  const gross = monthReservations.reduce((s: number, r: any) =>
    s + prorateForMonth(toUSD(r.owner_revenue ?? 0, r.currency), r.nights ?? 0, r.check_in, r.check_out, monthStart, monthEnd), 0)
  const adr = totalBookedNights > 0 ? Math.round(gross / totalBookedNights) : 0

  const commissionRate = (property.nok_commission_rate ?? 0) / 100
  const nokCommission = gross * commissionRate

  let cleaning = 0
  if (property.cleaning_fee && checkouts > 0) {
    const raw = property.cleaning_fee as number
    cleaning = property.cleaning_fee_currency === 'COP'
      ? await copToUSD(raw * checkouts)
      : raw * checkouts
  }

  const directCommission = monthReservations.reduce((s: number, r: any) => {
    if (!isDirect(r.channel)) return s
    const pr = prorateForMonth(toUSD(r.owner_revenue ?? 0, r.currency), r.nights ?? 0, r.check_in, r.check_out, monthStart, monthEnd)
    return s + (pr > 0 ? pr * DIRECT_RATE : 0)
  }, 0)

  let utilities = 0
  for (const u of (monthUtilRes.data ?? []) as any[]) {
    const amt = Number(u.amount) || 0
    utilities += (u.currency || 'COP').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }

  let maintenance = 0
  for (const m of ((monthMaintRes as any)?.data ?? []) as any[]) {
    const amt = Number(m.amount) || 0
    maintenance += (m.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }

  const nokNet = gross - nokCommission - cleaning - directCommission - utilities - maintenance

  // Owner-entered expenses that apply to this month
  const monthStartDate = new Date(monthStart + 'T00:00:00')
  const monthEndDate = new Date(monthEnd + 'T00:00:00')
  const ownerCostRows = (((ownerCostsRes as any)?.data ?? []) as OwnerCostRow[])
  const ownerExpenses: OwnerExpenseLine[] = []
  for (const c of ownerCostRows) {
    const amt = costAmountForMonth(c, monthStartDate, monthEndDate)
    if (!amt) continue
    ownerExpenses.push({
      id: c.id,
      label: c.label,
      category: c.category,
      frequency: c.frequency,
      amountOriginal: amt,
      currency: c.currency,
      amountUSD: toUSD(amt, c.currency),
      notes: c.notes,
    })
  }
  const ownerExpensesTotal = ownerExpenses.reduce((s, e) => s + e.amountUSD, 0)

  return {
    monthKey,
    propertyName: property.name || '',
    currencyNote: `Valores en USD. TRM aplicada: ${Math.round(trm).toLocaleString('en-US')} COP/USD.`,
    nights: totalBookedNights,
    occupancyPct,
    adr,
    reservationsCount: monthReservations.length,
    checkouts,
    gross,
    commissionRate,
    nokCommission,
    cleaning,
    directCommission,
    utilities,
    maintenance,
    nokNet,
    ownerExpenses,
    ownerExpensesTotal,
    finalNet: nokNet - ownerExpensesTotal,
  }
}

export const MONTH_LABELS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number)
  return `${MONTH_LABELS[m - 1]} ${y}`
}
