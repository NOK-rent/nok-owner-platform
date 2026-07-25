/**
 * AI Tool definitions for the NOK Owner chatbot.
 *
 * All tools read from Supabase (synced data) — never Guesty API directly.
 * This makes the chat fast and avoids rate limiting.
 *
 * Each factory function captures propertyId via closure so the AI
 * doesn't need to know or pass it.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'

// ─── RESERVATIONS ──────────────────────────────────────────────────────────

export const getUpcomingReservationsTool = (propertyId: string) =>
  tool({
    description:
      'Get upcoming confirmed reservations for the property. Use when the owner asks about who is coming, occupancy, next guests, or future reservations.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
    execute: async ({ limit = 10 }) => {
      const sb = createServiceClient()
      const today = new Date().toISOString().split('T')[0]
      const { data } = await sb
        .from('reservations')
        .select('check_in, check_out, nights, guest_name, channel, num_guests, owner_revenue, currency')
        .eq('property_id', propertyId)
        .in('status', ['confirmed', 'checked_in', 'checked_out'])
        .gte('check_in', today)
        .order('check_in', { ascending: true })
        .limit(limit)
      return data ?? []
    },
  })

export const getPricingForPeriodTool = (propertyId: string) =>
  tool({
    description:
      'Get pricing and availability for a specific date range. Use when the owner asks about rates for holidays, events, or specific dates.',
    inputSchema: z.object({
      checkIn: z.string().describe('Check-in date YYYY-MM-DD'),
      checkOut: z.string().describe('Check-out date YYYY-MM-DD'),
    }),
    execute: async ({ checkIn, checkOut }) => {
      const sb = createServiceClient()
      const { data: days } = await sb
        .from('pricing_calendar')
        .select('calendar_date, base_rate, is_available, is_blocked, min_stay_nights, currency')
        .eq('property_id', propertyId)
        .gte('calendar_date', checkIn)
        .lte('calendar_date', checkOut)
        .order('calendar_date')

      const allDays = days ?? []
      const withPrice = allDays.filter(d => d.base_rate && d.base_rate > 0)

      // El calendario de Guesty se cachea ~12 meses hacia adelante. Si no hay
      // filas para estas fechas, NO significa que la tarifa sea 0 — significa
      // que aún no hay tarifa publicada/sincronizada para ese período.
      if (allDays.length === 0) {
        return {
          checkIn,
          checkOut,
          status: 'no_rates_published',
          message:
            'Todavía no hay tarifas publicadas en el calendario para esas fechas. ' +
            'Suele pasar con fechas lejanas (temporada alta del próximo año) que el ' +
            'equipo de Revenue aún no ha cargado en Guesty. No asumas que el precio es 0.',
        }
      }
      if (withPrice.length === 0) {
        return {
          checkIn,
          checkOut,
          status: 'rates_pending',
          totalNights: allDays.length,
          message:
            'Existe disponibilidad en el calendario pero aún sin tarifa cargada para ' +
            'estas fechas. No asumas que el precio es 0; la tarifa está pendiente de publicar.',
        }
      }

      const available = allDays.every(d => d.is_available && !d.is_blocked)
      const avgRate = withPrice.reduce((s, d) => s + d.base_rate, 0) / withPrice.length

      return {
        checkIn,
        checkOut,
        status: 'ok',
        totalNights: allDays.length,
        nightsWithRate: withPrice.length,
        available,
        avgNightlyRate: Math.round(avgRate),
        minNightlyRate: Math.min(...withPrice.map(d => d.base_rate)),
        maxNightlyRate: Math.max(...withPrice.map(d => d.base_rate)),
        estimatedTotal: Math.round(avgRate * allDays.length),
        currency: allDays[0]?.currency ?? 'USD',
      }
    },
  })

export const getCalendarTool = (propertyId: string) =>
  tool({
    description:
      'Get the availability calendar for a date range. Use when the owner asks what dates are available or occupied.',
    inputSchema: z.object({
      from: z.string().describe('Start date YYYY-MM-DD'),
      to: z.string().describe('End date YYYY-MM-DD'),
    }),
    execute: async ({ from, to }) => {
      const sb = createServiceClient()
      const { data: reservations } = await sb
        .from('reservations')
        .select('check_in, check_out, guest_name, channel, nights')
        .eq('property_id', propertyId)
        .neq('status', 'cancelled')
        .lte('check_in', to)
        .gte('check_out', from)

      const resList = reservations ?? []
      // Count booked days in range
      let bookedDays = 0
      const fromDate = new Date(from + 'T00:00:00')
      const toDate = new Date(to + 'T00:00:00')
      const totalDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1

      for (const r of resList) {
        const rIn = new Date(r.check_in + 'T00:00:00')
        const rOut = new Date(r.check_out + 'T00:00:00')
        const start = rIn > fromDate ? rIn : fromDate
        const end = rOut < toDate ? rOut : toDate
        const days = Math.round((end.getTime() - start.getTime()) / 86400000)
        if (days > 0) bookedDays += days
      }

      return {
        from,
        to,
        totalDays,
        availableDays: totalDays - bookedDays,
        bookedDays,
        occupancyRate: totalDays ? Math.round((bookedDays / totalDays) * 100) : 0,
        reservations: resList.map(r => ({
          checkIn: r.check_in,
          checkOut: r.check_out,
          guest: r.guest_name,
          channel: r.channel,
          nights: r.nights,
        })),
      }
    },
  })

// ─── REVENUE ───────────────────────────────────────────────────────────────

export const getMonthlyRevenueTool = (propertyId: string) =>
  tool({
    description:
      'Get revenue earned for a specific month. Use when the owner asks how much they earned or what the income was.',
    inputSchema: z.object({
      year: z.number().describe('4-digit year'),
      month: z.number().min(1).max(12).describe('Month 1-12'),
    }),
    execute: async ({ year, month }) => {
      const sb = createServiceClient()
      const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
      const lastDay = new Date(year, month, 0).toISOString().split('T')[0]

      const { data } = await sb
        .from('reservations')
        .select('owner_revenue, currency, check_in, guest_name, channel, nights')
        .eq('property_id', propertyId)
        .neq('status', 'cancelled')
        .gte('check_in', firstDay)
        .lte('check_in', lastDay)

      const reservations = data ?? []
      const revenue = reservations.reduce((s, r) => s + (r.owner_revenue ?? 0), 0)

      return {
        year,
        month,
        revenue,
        currency: reservations[0]?.currency ?? 'USD',
        reservationCount: reservations.length,
        reservations: reservations.map(r => ({
          guest: r.guest_name,
          checkIn: r.check_in,
          nights: r.nights,
          channel: r.channel,
          revenue: r.owner_revenue,
        })),
      }
    },
  })

export const getPropertyMetricsTool = (propertyId: string) =>
  tool({
    description:
      'Get the latest performance metrics: occupancy, revenue, avg daily rate.',
    inputSchema: z.object({}),
    execute: async () => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('property_metrics')
        .select('*')
        .eq('property_id', propertyId)
        .order('metric_date', { ascending: false })
        .limit(1)
        .single()
      return data ?? { message: 'No metrics available yet' }
    },
  })

// ─── REVIEWS ───────────────────────────────────────────────────────────────

export const getReviewsTool = (propertyId: string) =>
  tool({
    description:
      'Get recent guest reviews. Use when the owner asks about reviews, ratings, or guest feedback.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Number of reviews (default 5)'),
    }),
    execute: async ({ limit = 5 }) => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('reviews')
        .select('overall_score, cleanliness_score, communication_score, guest_name, reviewer_text, host_response, channel, submitted_at')
        .eq('property_id', propertyId)
        .order('submitted_at', { ascending: false })
        .limit(limit)
      return data ?? []
    },
  })

export const getReviewStatsTool = (propertyId: string) =>
  tool({
    description:
      'Get aggregate review statistics: average score, total count, category averages.',
    inputSchema: z.object({}),
    execute: async () => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('reviews')
        .select('overall_score, cleanliness_score, communication_score, checkin_score, accuracy_score, location_score, value_score')
        .eq('property_id', propertyId)

      const reviews = data ?? []
      if (!reviews.length) return { count: 0, message: 'No reviews yet' }

      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
      const scores = (field: string) => reviews.map(r => (r as any)[field]).filter((v: any) => v != null && v > 0) as number[]

      return {
        count: reviews.length,
        averageRating: Number(avg(scores('overall_score')).toFixed(2)),
        averageCleanliness: Number(avg(scores('cleanliness_score')).toFixed(2)),
        averageCommunication: Number(avg(scores('communication_score')).toFixed(2)),
      }
    },
  })

// ─── OPERATIONS ────────────────────────────────────────────────────────────

export const getLastCleaningTool = (propertyId: string) =>
  tool({
    description:
      'Get recent cleaning records. Use when owner asks about last cleaning or operational status.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Number of records (default 3)'),
    }),
    execute: async ({ limit = 3 }) => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('cleaning_records')
        .select('scheduled_at, completed_at, staff_name, status, duration_minutes, notes')
        .eq('property_id', propertyId)
        .order('scheduled_at', { ascending: false })
        .limit(limit)
      return data ?? []
    },
  })

export const getMaintenanceTool = (propertyId: string) =>
  tool({
    description: 'Get recent maintenance and inspection records.',
    inputSchema: z.object({
      limit: z.number().optional().describe('Number of records (default 5)'),
    }),
    execute: async ({ limit = 5 }) => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('maintenance_records')
        .select('type, title, scheduled_at, completed_at, staff_name, status, priority, notes')
        .eq('property_id', propertyId)
        .order('scheduled_at', { ascending: false })
        .limit(limit)
      return data ?? []
    },
  })

// ─── INVENTORY ─────────────────────────────────────────────────────────────

export const getInventoryAlertsTool = (propertyId: string) =>
  tool({
    description: 'Get inventory items that need attention or replacement.',
    inputSchema: z.object({}),
    execute: async () => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('inventory_items')
        .select('name, category, quantity, condition, last_replaced_at, notes')
        .eq('property_id', propertyId)
        .in('condition', ['poor', 'needs_replacement', 'fair'])
        .order('condition')
      return data ?? []
    },
  })

export const getFullInventoryTool = (propertyId: string) =>
  tool({
    description: 'Get the complete inventory list for the property.',
    inputSchema: z.object({}),
    execute: async () => {
      const sb = createServiceClient()
      const { data } = await sb
        .from('inventory_items')
        .select('name, category, quantity, condition, last_replaced_at')
        .eq('property_id', propertyId)
        .order('category')
      return data ?? []
    },
  })

// ─── KNOWLEDGE BASE ────────────────────────────────────────────────────────

export const searchKnowledgeTool = () =>
  tool({
    description:
      'Consulta la base de conocimiento de NOK sobre alquiler de corto plazo: temporada alta/baja, cómo se fijan las tarifas (pricing dinámico), ADR/ocupación/RevPAR, comisión NOK, costos y políticas. Úsala SIEMPRE que el propietario haga una pregunta general de mercado o de cómo funciona algo (no específica de un dato de su propiedad). Por ejemplo: "¿cuándo es temporada alta?", "¿por qué cambian los precios?", "¿qué es el ADR?".',
    inputSchema: z.object({
      topic: z
        .string()
        .optional()
        .describe('Palabras clave del tema a buscar (ej. "temporada alta", "pricing", "comision"). Vacío = traer todo.'),
    }),
    execute: async ({ topic }) => {
      const sb = createServiceClient()
      let query = sb
        .from('ai_knowledge')
        .select('category, title, content, country')
        .eq('is_active', true)

      if (topic && topic.trim()) {
        const t = topic.trim()
        query = query.or(`title.ilike.%${t}%,content.ilike.%${t}%,tags.cs.{${t}}`)
      }

      const { data } = await query.limit(8)
      const entries = data ?? []
      if (!entries.length) {
        // Fallback: sin match, devolver todo lo activo para que el modelo elija.
        const { data: all } = await sb
          .from('ai_knowledge')
          .select('category, title, content, country')
          .eq('is_active', true)
          .limit(8)
        return all ?? []
      }
      return entries
    },
  })

// ─── SUPPORT TICKETS ───────────────────────────────────────────────────────

export const createSupportTicketTool = (propertyId: string, ownerId: string) =>
  tool({
    description: 'Create a support ticket for the NOK team when the owner needs human assistance.',
    inputSchema: z.object({
      title: z.string().describe('Brief title'),
      description: z.string().describe('Detailed description'),
      priority: z.enum(['low', 'medium', 'high', 'urgent']).describe('Priority level'),
    }),
    execute: async ({ title, description, priority }) => {
      const sb = createServiceClient()
      const { data, error } = await sb
        .from('support_tickets')
        .insert({ property_id: propertyId, owner_id: ownerId, title, description, priority })
        .select('id, status')
        .single()

      if (error) throw new Error(error.message)
      return { ticketId: data.id, status: data.status, message: 'Ticket creado. El equipo NOK te contactará pronto.' }
    },
  })

// ─── REVENUE MANAGEMENT (Wheelhouse, en vivo) ──────────────────────────────

export const getRevenueStrategyTool = (property: { wheelhouse_property_id?: string | null; guesty_listing_id?: string | null }) =>
  tool({
    description:
      'Get the LIVE revenue management strategy and market comparison for this property: today\'s published rate, base price breakdown (why the price is what it is: market baseline, bedrooms, location, amenities...), occupancy vs the surrounding zone, upcoming rate calendar vs zone median, demand sensitivity settings, named seasons, revenue score and engine alerts. Use whenever the owner asks WHY their price is set a certain way, how their unit compares to the market/zone, what the pricing strategy is, about discounts, minimum stays, seasons, or anything about revenue management. Data comes from the NOK Revenue Management engine. Never mention the vendor name "Wheelhouse" — call it "Revenue Management NOK" / "el motor de revenue de NOK". Say "zona" (never "barrio") for the comparable-market area.',
    inputSchema: z.object({}),
    execute: async () => {
      const { getRevenueSnapshot, resolveWheelhouseRef } = await import('@/lib/wheelhouse')
      const ref = resolveWheelhouseRef(property)
      if (!ref) return { status: 'not_configured', message: 'Esta propiedad aún no está conectada al motor de Revenue Management.' }
      const s = await getRevenueSnapshot(ref.id, ref.channel)
      if (!s) return { status: 'unavailable', message: 'Los datos de Revenue Management no están disponibles en este momento. No inventes valores.' }

      // Condense the 60-day rate calendar into weekly buckets to keep context small
      const weeks: { desde: string; nuestra_mediana: number | null; zona_mediana: number | null }[] = []
      for (let i = 0; i < s.rateDays.length; i += 7) {
        const chunk = s.rateDays.slice(i, i + 7)
        const med = (vals: (number | null)[]) => {
          const v = vals.filter((x): x is number => x != null).sort((a, b) => a - b)
          return v.length ? Math.round(v[Math.floor(v.length / 2)]) : null
        }
        weeks.push({ desde: chunk[0].date, nuestra_mediana: med(chunk.map(d => d.ours)), zona_mediana: med(chunk.map(d => d.zoneMedian)) })
      }

      return {
        plan: s.tierName,
        horizonte_dias: s.horizonDays,
        tarifa_publicada_hoy_usd: s.todayPrice,
        posicion_vs_zona_pct: s.posVsZonePct,
        comparables_en_zona: s.zoneListings,
        noches_vendidas_ultimos_7d: s.pickup7,
        ocupacion_vs_zona: s.occWindows.map(w => ({
          ventana: w.label,
          unidad: w.unit != null ? Math.round(w.unit * 100) + '%' : null,
          zona: w.zone != null ? Math.round(w.zone * 100) + '%' : null,
        })),
        tarifas_por_semana_usd: weeks,
        estrategia: s.strategy.map(x => `${x.tag}: ${x.text}`),
        precio_base: s.basePrice
          ? {
              recomendado_usd: s.basePrice.recommended,
              aplicado_usd: s.basePrice.selected,
              rango_motor_usd: [s.basePrice.conservative, s.basePrice.aggressive],
              confianza_modelo_pct: s.basePrice.anchorCredibility,
              desglose: s.basePrice.attribution,
            }
          : null,
        sensibilidad_demanda_pct: s.demandSensitivityPct,
        pacing_ocupacion_activo: s.pacingAdjusted,
        anclaje_historial_pct: s.historicalAnchoringPct,
        proximas_temporadas: s.upcomingSeasons,
        revenue_score_30d: s.revenueScore30,
        ratio_ocupacion_vs_zona_30d: s.occRatio30 != null ? Number(s.occRatio30.toFixed(1)) : null,
        alertas_motor: s.flags,
        nota: 'Montos en USD. Datos en vivo del motor de Revenue Management NOK (se refrescan cada hora).',
      }
    },
  })
