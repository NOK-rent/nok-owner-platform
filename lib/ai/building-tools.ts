/**
 * Herramientas del chat NOK AI para un edificio completo (net-commission).
 *
 * Cada factory cierra sobre el contexto del edificio (config + unidades) para
 * que el modelo nunca tenga que pasar ids. Todo lee de Supabase (datos ya
 * sincronizados) — nunca APIs externas. Nunca devolvemos rutas de storage.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { computeBuildingPnl, normalizeChannel, categoryMeta, type BuildingConfig } from '@/lib/building-pnl'
import { computeBuildingFacts, todayYmd, addDays } from '@/lib/ai/building-briefing'

export interface BuildingToolContext {
  configId: string
  propertyIds: string[]
  properties: { id: string; name: string; active?: boolean }[]
  config: BuildingConfig
}

const r0 = (n: number) => Math.round(n)
const idListOf = (ids: string[]) => (ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])

function unitByName(ctx: BuildingToolContext, unit: string | undefined) {
  if (!unit) return null
  const q = unit.trim().toLowerCase()
  return ctx.properties.find(p => p.id === unit || p.name.toLowerCase() === q)
    ?? ctx.properties.find(p => p.name.toLowerCase().includes(q))
    ?? null
}

// ─── P&L ───────────────────────────────────────────────────────────────────

export const getBuildingPnlTool = (ctx: BuildingToolContext) =>
  tool({
    description:
      'P&L del edificio bajo el modelo net-commission: ingresos netos, costos por categoría, NOI, si se alcanzó el umbral de comisión, comisión NOK y neto al propietario. Sin month devuelve el acumulado del año (YTD) más el resumen de cada mes. Úsala para "cuánto ganó el edificio", "NOI", "cuándo cobra NOK comisión", "margen", "costos totales".',
    inputSchema: z.object({
      year: z.number().optional().describe('Año (4 dígitos). Por defecto el actual.'),
      month: z.number().min(1).max(12).optional().describe('Mes 1-12. Si se omite: YTD.'),
    }),
    execute: async ({ year, month }) => {
      const sb = createServiceClient() as any
      const y = year ?? new Date().getFullYear()
      const props = ctx.properties.map(p => ({ id: p.id, name: p.name, active: p.active !== false }))
      const pnl = await computeBuildingPnl(sb, ctx.config, props, y)
      const cats = (byCat: Record<string, number>) =>
        Object.entries(byCat).map(([k, v]) => ({ categoria: categoryMeta(k).label, usd: r0(v) })).sort((a, b) => b.usd - a.usd)
      const base = {
        edificio: pnl.config.name, unidades: pnl.config.propertyCount, moneda: 'USD',
        comision_pct_sobre_noi: pnl.config.commissionRate,
        umbral_cop: pnl.config.thresholdCop, umbral_base: pnl.config.thresholdBasis === 'gross' ? 'ingreso bruto' : 'NOI',
      }
      if (month) {
        const key = `${y}-${String(month).padStart(2, '0')}`
        const m = pnl.months.find(x => x.month === key)
        if (!m) return { ...base, mes: key, status: 'sin_datos', message: 'Ese mes no está dentro del período reportado del edificio.' }
        const perUnit = pnl.properties.map(p => ({ unidad: p.name, neto_usd: r0(p.byMonth[key]?.net ?? 0), noches: p.byMonth[key]?.nights ?? 0, ocupacion_pct: r0(p.byMonth[key]?.occupancy ?? 0) }))
          .sort((a, b) => b.neto_usd - a.neto_usd)
        return {
          ...base, mes: key, es_proyeccion: m.isFuture,
          ingreso_bruto_usd: r0(m.gross), ingreso_neto_usd: r0(m.net), comisiones_canal_usd: r0(m.channelFees),
          noches: m.nights, reservas: m.reservations, checkouts: m.checkouts, ocupacion_pct: r0(m.occupancy), adr_usd: r0(m.adr),
          costos: { por_categoria: cats(m.costs.byCategory), servicios_unidades_usd: r0(m.costs.utilities), mantenimiento_unidades_usd: r0(m.costs.maintenance), total_usd: r0(m.costs.total) },
          noi_usd: r0(m.noi), trm_cop_por_usd: r0(m.trm), base_umbral_cop: m.thresholdBasisCop, umbral_alcanzado: m.thresholdReached,
          comision_pct_aplicada: m.commissionRate, comision_usd: r0(m.commission), neto_propietario_usd: r0(m.ownerNet),
          por_unidad: perUnit,
        }
      }
      return {
        ...base, anio: y, nota: 'YTD solo suma meses cerrados (hasta el actual).',
        ytd: {
          ingreso_neto_usd: r0(pnl.ytd.net), costos_usd: r0(pnl.ytd.costs.total), noi_usd: r0(pnl.ytd.noi),
          comision_usd: r0(pnl.ytd.commission), neto_propietario_usd: r0(pnl.ytd.ownerNet),
          ocupacion_pct: r0(pnl.ytd.occupancy), adr_usd: r0(pnl.ytd.adr), margen_pct: r0(pnl.ytd.margin),
          costos_por_categoria: cats(pnl.ytd.costs.byCategory),
        },
        meses: pnl.months.map(m => ({ mes: m.month, proyeccion: m.isFuture, neto_usd: r0(m.net), costos_usd: r0(m.costs.total), noi_usd: r0(m.noi), umbral_alcanzado: m.thresholdReached, comision_usd: r0(m.commission), neto_propietario_usd: r0(m.ownerNet), ocupacion_pct: r0(m.occupancy) })),
        por_unidad_ytd: pnl.properties.map(p => ({ unidad: p.name, neto_usd: r0(p.totals.net), noches: p.totals.nights, reservas: p.totals.reservations })).sort((a, b) => b.neto_usd - a.neto_usd),
      }
    },
  })

// ─── RESERVAS ──────────────────────────────────────────────────────────────

export const getBuildingReservationsTool = (ctx: BuildingToolContext) =>
  tool({
    description:
      'Reservas del edificio (todas las unidades o una) en un rango de fechas: huésped, unidad, fechas, noches, canal, estado, ingreso neto. Por defecto: próximos 30 días. Úsala para "qué reservas entran esta semana", "quién está en casa", "reservas de la unidad 302".',
    inputSchema: z.object({
      from: z.string().optional().describe('Desde YYYY-MM-DD (default hoy)'),
      to: z.string().optional().describe('Hasta YYYY-MM-DD inclusive (default hoy+30)'),
      unit: z.string().optional().describe('Nombre de la unidad (ej. "Wellness 302") para filtrar'),
    }),
    execute: async ({ from, to, unit }) => {
      const sb = createServiceClient() as any
      const today = todayYmd()
      const f = from ?? today
      const t = to ?? addDays(f, 30)
      const u = unitByName(ctx, unit)
      if (unit && !u) return { status: 'unidad_no_encontrada', unidades: ctx.properties.map(p => p.name) }
      const ids = u ? [u.id] : ctx.propertyIds
      const { data } = await sb.from('reservations')
        .select('property_id, check_in, check_out, nights, guest_name, channel, status, num_guests, owner_revenue, currency, is_blocked')
        .in('property_id', idListOf(ids))
        .not('status', 'in', '(canceled,cancelled,declined,expired,inquiry)')
        .lte('check_in', t).gt('check_out', f)
        .order('check_in', { ascending: true }).limit(300)
      const nameOf = Object.fromEntries(ctx.properties.map(p => [p.id, p.name]))
      const rows = (data ?? []).filter((r: any) => r.is_blocked !== true)
      return {
        desde: f, hasta: t, total: rows.length,
        reservas: rows.map((r: any) => ({
          unidad: nameOf[r.property_id] ?? '—', huesped: r.guest_name ?? 'Huésped', check_in: r.check_in, check_out: r.check_out,
          noches: r.nights, canal: normalizeChannel(r.channel), estado: r.status, huespedes: r.num_guests,
          ingreso_neto: r.owner_revenue != null ? r0(Number(r.owner_revenue)) : null, moneda: r.currency ?? 'USD',
        })),
      }
    },
  })

// ─── OCUPACIÓN ─────────────────────────────────────────────────────────────

export const getBuildingOccupancyTool = (ctx: BuildingToolContext) =>
  tool({
    description:
      'Ocupación del edificio para los próximos N días (30, 60 o 90): total y por unidad, con ADR de los últimos 30 días, próxima reserva y tarifa publicada. Úsala para "qué unidades tienen menor ocupación", "cómo viene el próximo mes", "ocupación del edificio".',
    inputSchema: z.object({
      days: z.number().min(1).max(90).optional().describe('Horizonte en días (30, 60 o 90). Default 30.'),
    }),
    execute: async ({ days = 30 }) => {
      const sb = createServiceClient() as any
      const props = ctx.properties.map(p => ({ id: p.id, name: p.name, active: p.active !== false }))
      const f = await computeBuildingFacts(sb, { id: ctx.configId, name: ctx.config.name }, props)
      const horizon: 30 | 60 | 90 = days <= 30 ? 30 : days <= 60 ? 60 : 90
      const pick = (u: { occ30: number; occ60: number; occ90: number }) => horizon === 30 ? u.occ30 : horizon === 60 ? u.occ60 : u.occ90
      const total = horizon === 30 ? f.occNext30 : horizon === 60 ? f.occNext60 : f.occNext90
      return {
        horizonte_dias: horizon, ocupacion_edificio_pct: total, unidades_activas: f.activeUnits,
        ocupacion_ultimos_30_pct: f.occLast30, adr_ultimos_30_usd: f.adrLast30,
        reservas_nuevas_7d: f.newBookings7d, neto_reservas_nuevas_7d_usd: f.newBookingsNetUSD,
        unidades_sin_reservas_30d: f.unitsWithoutBookingsNext30,
        tarifa_promedio_publicada_30d: f.avgPublishedRateNext30, moneda_tarifa: f.publishedRateCurrency,
        por_unidad: [...f.perUnit].sort((a, b) => pick(b) - pick(a)).map(u => ({
          unidad: u.name, activa: u.active, ocupacion_pct: pick(u), ocupacion_30_pct: u.occ30, ocupacion_90_pct: u.occ90,
          adr_30d_usd: u.adr30, proxima_reserva: u.nextCheckIn, tarifa_hoy: u.rateToday, tarifa_promedio_30d: u.rateAvg30,
        })),
      }
    },
  })

// ─── COSTOS ────────────────────────────────────────────────────────────────

export const getBuildingCostsTool = (ctx: BuildingToolContext) =>
  tool({
    description:
      'Líneas de costo del edificio aplicadas a un mes: categoría (nómina, limpieza, lavandería, insumos, servicios, mantenimiento, administración, otros), proveedor, monto, moneda y si tiene factura adjunta. Úsala para "cuánto se gastó en lavandería", "qué facturas hay de mayo", "costos de nómina".',
    inputSchema: z.object({
      month: z.string().optional().describe('Mes YYYY-MM. Default: mes actual.'),
    }),
    execute: async ({ month }) => {
      const sb = createServiceClient() as any
      const key = month && /^\d{4}-\d{2}$/.test(month) ? month : todayYmd().slice(0, 7)
      const y = Number(key.slice(0, 4))
      const props = ctx.properties.map(p => ({ id: p.id, name: p.name, active: p.active !== false }))
      const pnl = await computeBuildingPnl(sb, ctx.config, props, y)
      const lines = pnl.costLines[key]
      if (!lines) return { mes: key, status: 'sin_datos', message: 'Ese mes no está dentro del período reportado del edificio.' }
      const nameOf = Object.fromEntries(ctx.properties.map(p => [p.id, p.name]))
      const byCat: Record<string, number> = {}
      for (const l of lines) { const c = categoryMeta(l.category).label; byCat[c] = (byCat[c] ?? 0) + l.amountUSD }
      return {
        mes: key, total_usd: r0(lines.reduce((s, l) => s + l.amountUSD, 0)), lineas: lines.length,
        por_categoria: Object.entries(byCat).map(([categoria, usd]) => ({ categoria, usd: r0(usd) })).sort((a, b) => b.usd - a.usd),
        detalle: lines.map(l => ({
          concepto: l.name, categoria: categoryMeta(l.category).label, proveedor: l.vendor ?? null,
          monto: r0(Number(l.amount)), moneda: l.currency, monto_usd: r0(l.amountUSD), frecuencia: l.frequency,
          fecha_factura: l.invoice_date ?? null, numero_factura: l.invoice_number ?? null,
          facturas_adjuntas: Array.isArray(l.attachments) ? l.attachments.length : 0,
          unidad: l.property_id ? (nameOf[l.property_id] ?? null) : null, notas: l.notes ?? null,
        })),
      }
    },
  })

// ─── UNIDADES ──────────────────────────────────────────────────────────────

export const getUnitListTool = (ctx: BuildingToolContext) =>
  tool({
    description: 'Lista las unidades del edificio con su nombre y si están activas. Úsala para saber cuántas y cuáles unidades componen el edificio.',
    inputSchema: z.object({}),
    execute: async () => ({
      edificio: ctx.config.name, total: ctx.properties.length,
      unidades: ctx.properties.map(p => ({ nombre: p.name, activa: p.active !== false })),
    }),
  })

/** Todas las herramientas del edificio (sin las compartidas: searchKnowledge / createSupportTicket). */
export function buildBuildingTools(ctx: BuildingToolContext) {
  return {
    getBuildingPnl: getBuildingPnlTool(ctx),
    getBuildingReservations: getBuildingReservationsTool(ctx),
    getBuildingOccupancy: getBuildingOccupancyTool(ctx),
    getBuildingCosts: getBuildingCostsTool(ctx),
    getUnitList: getUnitListTool(ctx),
  }
}
