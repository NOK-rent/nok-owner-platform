/**
 * P&L de edificio (net-commission model) — fuente única de verdad para el
 * portal del propietario (/dashboard/edificio/[configId]) y para la "Vista
 * propietario" del hub (nok-hub /edificios, que consume /api/edificio/[id]/pnl).
 *
 * Modelo (misma familia que Gardens/Ekkos en nok-special-properties, pero con
 * las convenciones de este portal para que cuadre con las pestañas por unidad):
 *   gross      = Σ accommodation_fare prorrateado por mes (lo que pagó el huésped por alojamiento)
 *   net        = Σ owner_revenue prorrateado por mes (después de comisiones de canal)
 *   costs      = building_pnl_costs (por categoría) + utility_costs + maintenance_costs de las unidades
 *   noi        = net − costs
 *   commission = NOI ≥ 0 y (base del mes en COP ≥ umbral) ? NOI × rate : 0
 *   ownerNet   = noi − commission
 *
 * TRM: promedio mensual del mes reportado (lib/trm.ts loadMonthlyFx), nunca la
 * tasa de hoy para meses cerrados.
 */

import { loadMonthlyFx, type MonthlyFx } from '@/lib/trm'

export type CostCategory =
  | 'nomina' | 'limpieza' | 'lavanderia' | 'insumos' | 'servicios'
  | 'mantenimiento' | 'administracion' | 'otros'

export const COST_CATEGORIES: { key: CostCategory; label: string; labelEn: string; color: string }[] = [
  { key: 'nomina',         label: 'Nómina',           labelEn: 'Payroll',      color: '#4D439E' },
  { key: 'limpieza',       label: 'Limpieza',         labelEn: 'Cleaning',     color: '#94B8CF' },
  { key: 'lavanderia',     label: 'Lavandería',       labelEn: 'Laundry',      color: '#0080C6' },
  { key: 'insumos',        label: 'Insumos',          labelEn: 'Supplies',     color: '#D6A700' },
  { key: 'servicios',      label: 'Servicios',        labelEn: 'Utilities',    color: '#0E6845' },
  { key: 'mantenimiento',  label: 'Mantenimiento',    labelEn: 'Maintenance',  color: '#833B0E' },
  { key: 'administracion', label: 'Administración',   labelEn: 'Admin',        color: '#B9B5DC' },
  { key: 'otros',          label: 'Otros',            labelEn: 'Other',        color: '#888888' },
]

export function categoryMeta(key: string | null | undefined) {
  return COST_CATEGORIES.find(c => c.key === key) ?? COST_CATEGORIES[COST_CATEGORIES.length - 1]
}

export interface BuildingConfig {
  id: string
  name: string
  property_ids: string[]
  commission_rate_on_net: number          // porcentaje 0–100 sobre NOI
  active: boolean
  owner_id?: string | null
  shared_emails?: string[] | null
  start_month?: string | null             // 'YYYY-MM'
  commission_threshold_cop?: number | null
  commission_threshold_basis?: 'noi' | 'gross' | null
  city?: string | null
  country?: string | null
  slug?: string | null
}

export interface BuildingAttachment { name: string; path: string; type?: string; size?: number; url?: string }

export interface BuildingCostRow {
  id: string
  config_id: string
  name: string
  amount: number
  currency: 'COP' | 'USD'
  frequency: 'monthly' | 'per_checkout' | 'one_time'
  month: string | null
  notes: string | null
  category?: string | null
  vendor?: string | null
  invoice_date?: string | null
  invoice_number?: string | null
  attachments?: BuildingAttachment[] | null
  property_id?: string | null
  created_by?: string | null
  created_at: string
  updated_at?: string
}

export interface BuildingMonth {
  month: string                 // 'YYYY-MM'
  isFuture: boolean             // mes posterior al actual (solo reservas confirmadas)
  gross: number                 // USD
  net: number                   // USD
  channelFees: number           // USD (gross − net)
  nights: number
  reservations: number
  checkouts: number
  occupancy: number             // 0–100
  adr: number                   // USD por noche (sobre net)
  costs: {
    byCategory: Record<string, number>   // USD por categoría de building_pnl_costs
    building: number                     // Σ byCategory
    utilities: number                    // utility_costs de las unidades
    maintenance: number                  // maintenance_costs de las unidades
    total: number
  }
  noi: number
  trm: number                   // COP por USD del mes
  thresholdBasisCop: number     // base del umbral (noi|gross) en COP
  thresholdReached: boolean
  commissionRate: number        // % aplicado ese mes (0 si no alcanzó el umbral)
  commission: number
  ownerNet: number
}

export interface BuildingPropertyMonth { gross: number; net: number; nights: number; reservations: number; checkouts: number; occupancy: number; adr: number }

export interface BuildingPropertySummary {
  id: string
  name: string
  active: boolean
  byMonth: Record<string, BuildingPropertyMonth>
  totals: { gross: number; net: number; nights: number; reservations: number }
}

export interface BuildingCostLine extends BuildingCostRow {
  amountUSD: number             // valor aplicado al mes (ya multiplicado por checkouts si per_checkout)
  appliedMonth: string
}

export interface BuildingPnl {
  config: {
    id: string; name: string; propertyCount: number; commissionRate: number
    thresholdCop: number; thresholdBasis: 'noi' | 'gross'; startMonth: string | null
    city: string | null; country: string | null
  }
  year: number
  generatedAt: string
  months: BuildingMonth[]
  ytd: {
    gross: number; net: number; channelFees: number; nights: number; reservations: number; checkouts: number
    costs: { byCategory: Record<string, number>; building: number; utilities: number; maintenance: number; total: number }
    noi: number; commission: number; ownerNet: number; occupancy: number; adr: number; margin: number
  }
  properties: BuildingPropertySummary[]
  /** Líneas de costo por mes (ya en USD) para la pestaña Costos y facturas. */
  costLines: Record<string, BuildingCostLine[]>
  channels: { channel: string; reservations: number; net: number; gross: number }[]
}

// ── helpers ────────────────────────────────────────────────────────────────

const VALID_STATUSES = ['confirmed', 'checked_in', 'checked_out']

function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate() }

/** Días de la reserva que caen dentro del mes [monthStart, monthEnd] (inclusive). */
export function overlapNights(checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  if (!checkIn || !checkOut) return 0
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1)
  const s = ci > ms ? ci : ms
  const e = co < me ? co : me
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / 86400000))
}

/** Noches reales entre check-in y check-out (fallback cuando `nights` viene null/0). */
export function spanNights(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0
  const ci = new Date(checkIn + 'T00:00:00').getTime()
  const co = new Date(checkOut + 'T00:00:00').getTime()
  return Math.max(0, Math.round((co - ci) / 86400000))
}

/** Prorratea un monto de la reserva al mes según noches solapadas. */
export function prorate(total: number, nights: number, checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  if (!total || nights <= 0) return 0
  const o = overlapNights(checkIn, checkOut, monthStart, monthEnd)
  if (o <= 0) return 0
  if (o >= nights) return total
  return (total / nights) * o
}

export function normalizeChannel(ch: string | null | undefined): string {
  const l = (ch ?? '').toLowerCase()
  if (!l) return 'Directo'
  if (l.includes('airbnb')) return 'Airbnb'
  if (l.includes('booking')) return 'Booking.com'
  if (l.includes('vrbo') || l.includes('homeaway')) return 'Vrbo'
  if (l.includes('marriott') || l.includes('homes')) return 'Marriott'
  if (l.includes('website') || l.includes('web')) return 'NOK.rent'
  if (l.includes('manual') || l.includes('owner') || l.includes('direct')) return 'Directo'
  return ch as string
}

export function currentMonthKey(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

/** Meses del año a reportar: desde start_month (si cae en el año) hasta diciembre. */
export function reportedMonths(year: number, startMonth: string | null | undefined): string[] {
  const all = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
  if (!startMonth || !/^\d{4}-\d{2}$/.test(startMonth)) return all
  const sy = Number(startMonth.slice(0, 4))
  if (sy > year) return []
  if (sy < year) return all
  return all.filter(m => m >= startMonth)
}

/** Monto (moneda original) que una línea de costo aplica a un mes dado. */
export function costAppliesToMonth(c: BuildingCostRow, month: string, checkouts: number, startMonth: string | null | undefined): number {
  const amt = Number(c.amount) || 0
  if (!amt) return 0
  if (c.frequency === 'one_time') return c.month === month ? amt : 0
  if (c.frequency === 'per_checkout') {
    if (c.month && c.month > month) return 0
    return amt * checkouts
  }
  // monthly: recurrente desde c.month (o desde el inicio del reporte si no tiene mes)
  const from = c.month || startMonth || '0000-00'
  return month >= from ? amt : 0
}

// ── cálculo principal ──────────────────────────────────────────────────────

export async function computeBuildingPnl(
  sb: any,
  config: BuildingConfig,
  properties: { id: string; name: string; active: boolean }[],
  year: number,
): Promise<BuildingPnl> {
  const months = reportedMonths(year, config.start_month)
  const propIds = properties.map(p => p.id)
  const idList = propIds.length ? propIds : ['00000000-0000-0000-0000-000000000000']
  const yearStart = `${year}-01-01`
  const yearEnd = `${year}-12-31`
  const thresholdCop = Number(config.commission_threshold_cop ?? 0) || 0
  const thresholdBasis: 'noi' | 'gross' = config.commission_threshold_basis === 'gross' ? 'gross' : 'noi'
  const rate = Number(config.commission_rate_on_net ?? 0) || 0

  const nowKey = currentMonthKey()
  const [resRes, costsRes, utilRes, maintRes, fx] = await Promise.all([
    sb.from('reservations')
      .select('id, property_id, check_in, check_out, nights, status, channel, currency, accommodation_fare, owner_revenue, is_blocked')
      .in('property_id', idList).in('status', VALID_STATUSES)
      .lte('check_in', yearEnd).gt('check_out', yearStart)
      .limit(5000),
    sb.from('building_pnl_costs').select('*').eq('config_id', config.id).order('created_at', { ascending: true }),
    months.length
      ? sb.from('utility_costs').select('property_id, amount, currency, month, utility_type').in('property_id', idList).in('month', months)
      : Promise.resolve({ data: [] }),
    sb.from('maintenance_costs').select('property_id, amount, currency, date, description, type').in('property_id', idList).gte('date', yearStart).lte('date', yearEnd),
    // Solo meses ya transcurridos (los futuros no tienen promedio: usan la tasa actual sin ir a buscarla)
    loadMonthlyFx(months.filter(m => m <= nowKey)) as Promise<MonthlyFx>,
  ])

  const reservations: any[] = (resRes.data ?? []).filter((r: any) => r.is_blocked !== true)
  const costs: BuildingCostRow[] = (costsRes.data ?? []) as BuildingCostRow[]
  const utilities: any[] = utilRes.data ?? []
  const maintenance: any[] = maintRes.data ?? []

  const propSummary: Record<string, BuildingPropertySummary> = {}
  for (const p of properties) {
    propSummary[p.id] = { id: p.id, name: p.name, active: p.active, byMonth: {}, totals: { gross: 0, net: 0, nights: 0, reservations: 0 } }
  }
  const channelAgg: Record<string, { ids: Set<string>; net: number; gross: number }> = {}
  const costLines: Record<string, BuildingCostLine[]> = {}
  const out: BuildingMonth[] = []
  let capacityYtd = 0
  let nightsYtd = 0

  for (const m of months) {
    const [y, mo] = m.split('-').map(Number)
    const dim = daysInMonth(y, mo)
    const mStart = `${m}-01`
    const mEnd = `${m}-${String(dim).padStart(2, '0')}`
    const toUSD = (amount: number, currency: string | null | undefined) => fx.toUSD(amount, currency, m)
    const trm = fx.rate('COP', m)

    let gross = 0, net = 0, nights = 0, resCount = 0, checkouts = 0
    const perProp: Record<string, BuildingPropertyMonth> = {}
    for (const p of properties) perProp[p.id] = { gross: 0, net: 0, nights: 0, reservations: 0, checkouts: 0, occupancy: 0, adr: 0 }

    const isFuture = m > nowKey
    for (const r of reservations) {
      // Check-out del mes: se cuenta ANTES del filtro de noches (un check-out el día 1
      // no tiene noches en este mes pero sí dispara limpieza/lavandería por check-out).
      const co = r.check_out >= mStart && r.check_out <= mEnd ? 1 : 0
      const pp = perProp[r.property_id]
      if (co) { checkouts++; if (pp) pp.checkouts++ }
      const o = overlapNights(r.check_in, r.check_out, mStart, mEnd)
      if (o <= 0) continue
      const rn = r.nights && r.nights > 0 ? Number(r.nights) : spanNights(r.check_in, r.check_out)
      const g = prorate(toUSD(Number(r.accommodation_fare) || 0, r.currency), rn, r.check_in, r.check_out, mStart, mEnd)
      const n = prorate(toUSD(Number(r.owner_revenue) || 0, r.currency), rn, r.check_in, r.check_out, mStart, mEnd)
      gross += g; net += n; nights += o; resCount++
      if (pp) { pp.gross += g; pp.net += n; pp.nights += o; pp.reservations++ }
      if (!isFuture) {
        const ch = normalizeChannel(r.channel)
        if (!channelAgg[ch]) channelAgg[ch] = { ids: new Set(), net: 0, gross: 0 }
        channelAgg[ch].ids.add(r.id); channelAgg[ch].net += n; channelAgg[ch].gross += g
      }
    }

    // Costos del edificio por categoría
    const byCategory: Record<string, number> = {}
    const lines: BuildingCostLine[] = []
    for (const c of costs) {
      const applied = costAppliesToMonth(c, m, checkouts, config.start_month)
      if (!applied) continue
      const usd = toUSD(applied, c.currency)
      const cat = (c.category || 'otros').toLowerCase()
      byCategory[cat] = (byCategory[cat] ?? 0) + usd
      lines.push({ ...c, amountUSD: usd, appliedMonth: m })
    }
    const buildingCosts = Object.values(byCategory).reduce((s, v) => s + v, 0)
    let util = 0
    for (const u of utilities) if (u.month === m) util += fx.toUSD(Number(u.amount) || 0, u.currency || 'COP', m)
    let maint = 0
    for (const x of maintenance) if ((x.date || '').slice(0, 7) === m) maint += fx.toUSD(Number(x.amount) || 0, x.currency || 'USD', m)
    const totalCosts = buildingCosts + util + maint

    const noi = net - totalCosts
    const basisUsd = thresholdBasis === 'gross' ? gross : noi
    const basisCop = Math.round(basisUsd * trm)
    const reached = thresholdCop <= 0 ? true : basisCop >= thresholdCop
    const appliedRate = reached ? rate : 0
    const commission = Math.max(0, noi) * appliedRate / 100
    const ownerNet = noi - commission
    // Capacidad = todas las unidades de la config (una unidad inactiva con reservas
    // en el mes sigue contando en el denominador; así nunca supera 100%).
    const capacity = properties.length * dim
    const occupancy = capacity > 0 ? (nights / capacity) * 100 : 0
    if (!isFuture) { capacityYtd += capacity; nightsYtd += nights }

    for (const p of properties) {
      const pp = perProp[p.id]
      pp.occupancy = dim > 0 ? (pp.nights / dim) * 100 : 0
      pp.adr = pp.nights > 0 ? pp.net / pp.nights : 0
      const ps = propSummary[p.id]
      ps.byMonth[m] = pp
      ps.totals.gross += pp.gross; ps.totals.net += pp.net; ps.totals.nights += pp.nights; ps.totals.reservations += pp.reservations
    }
    costLines[m] = lines

    out.push({
      month: m,
      isFuture,
      gross, net, channelFees: gross - net,
      nights, reservations: resCount, checkouts,
      occupancy, adr: nights > 0 ? net / nights : 0,
      costs: { byCategory, building: buildingCosts, utilities: util, maintenance: maint, total: totalCosts },
      noi, trm,
      thresholdBasisCop: basisCop, thresholdReached: reached,
      commissionRate: appliedRate, commission, ownerNet,
    })
  }

  // YTD: solo meses hasta el actual (los futuros son proyección)
  const closed = out.filter(m => !m.isFuture)
  const ytdCat: Record<string, number> = {}
  for (const m of closed) for (const [k, v] of Object.entries(m.costs.byCategory)) ytdCat[k] = (ytdCat[k] ?? 0) + v
  const sum = (f: (m: BuildingMonth) => number) => closed.reduce((s, m) => s + f(m), 0)
  const ytdNet = sum(m => m.net)
  const ytdNights = sum(m => m.nights)
  const ytdNoi = sum(m => m.noi)
  const ytd = {
    gross: sum(m => m.gross), net: ytdNet, channelFees: sum(m => m.channelFees),
    nights: ytdNights, reservations: sum(m => m.reservations), checkouts: sum(m => m.checkouts),
    costs: {
      byCategory: ytdCat,
      building: sum(m => m.costs.building), utilities: sum(m => m.costs.utilities),
      maintenance: sum(m => m.costs.maintenance), total: sum(m => m.costs.total),
    },
    noi: ytdNoi, commission: sum(m => m.commission), ownerNet: sum(m => m.ownerNet),
    occupancy: capacityYtd > 0 ? (nightsYtd / capacityYtd) * 100 : 0,
    adr: ytdNights > 0 ? ytdNet / ytdNights : 0,
    margin: ytdNet > 0 ? (ytdNoi / ytdNet) * 100 : 0,
  }

  return {
    config: {
      id: config.id, name: config.name, propertyCount: properties.length, commissionRate: rate,
      thresholdCop, thresholdBasis, startMonth: config.start_month ?? null,
      city: config.city ?? null, country: config.country ?? null,
    },
    year,
    generatedAt: new Date().toISOString(),
    months: out,
    ytd,
    properties: Object.values(propSummary).sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })),
    costLines,
    channels: Object.entries(channelAgg)
      .map(([channel, v]) => ({ channel, reservations: v.ids.size, net: v.net, gross: v.gross }))
      .sort((a, b) => b.net - a.net),
  }
}

// ── formato ────────────────────────────────────────────────────────────────

export function fmtUSD(n: number | null | undefined, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: digits }).format(n)
}

export function fmtCOP(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthLabel(key: string, locale: 'es' | 'en' = 'es') {
  const [y, m] = key.split('-').map(Number)
  return `${(locale === 'en' ? MONTHS : MESES)[m - 1]} ${y}`
}
