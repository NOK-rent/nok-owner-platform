/**
 * Operations facts del mes para el owner:
 *  - mensajes respondidos por NOK (Guesty conversations → posts sentBy=host, cache 24h)
 *  - limpiezas realizadas (cx_limpieza, misma Supabase que nok-hub)
 *  - camas tendidas = habitaciones × check-outs del mes
 * Los mensajes se cachean en system_cache para no golpear Guesty en cada vista.
 */
import { getAccessToken } from '@/lib/guesty'

export interface OperationsFacts {
  mensajes: number | null // null = sin dato (API caída) — la UI lo oculta
  limpiezas: number
  camas: number
}

const G = 'https://open-api.guesty.com/v1'

async function countHostMessages(sb: any, propertyId: string, monthStart: string, monthEndExclusive: string): Promise<number | null> {
  const cacheKey = `ops_msgs_${propertyId}_${monthStart.slice(0, 7)}`
  try {
    const { data: cached } = await sb.from('system_cache').select('value, expires_at').eq('key', cacheKey).single()
    if (cached && new Date(cached.expires_at) > new Date()) return Number(cached.value)
  } catch { /* miss */ }

  try {
    const token = await getAccessToken()
    const H = { Authorization: `Bearer ${token}` }

    // Reservas del property que tocan el mes (acota las conversaciones a mirar)
    const { data: monthRes } = await sb
      .from('reservations')
      .select('guesty_reservation_id')
      .eq('property_id', propertyId)
      .not('guesty_reservation_id', 'is', null)
      .lte('check_in', monthEndExclusive)
      .gt('check_out', monthStart)
      .limit(15)

    let total = 0
    let partial = false // si alguna llamada a Guesty falló, el conteo está incompleto
    for (const r of monthRes ?? []) {
      try {
        const resp = await fetch(`${G}/reservations/${r.guesty_reservation_id}?fields=conversationId`, { headers: H, cache: 'no-store' })
        if (resp.status === 429) { partial = true; break }
        if (!resp.ok) { partial = true; continue }
        const { conversationId } = await resp.json()
        if (!conversationId) continue
        const pResp = await fetch(`${G}/communication/conversations/${conversationId}/posts?limit=100`, { headers: H, cache: 'no-store' })
        if (pResp.status === 429) { partial = true; break }
        if (!pResp.ok) { partial = true; continue }
        const pData = await pResp.json()
        const posts = pData.data?.posts || pData.posts || (Array.isArray(pData.data) ? pData.data : [])
        total += posts.filter((p: any) =>
          p.sentBy === 'host' && p.createdAt >= monthStart && p.createdAt < monthEndExclusive
        ).length
      } catch { partial = true }
      await new Promise(res => setTimeout(res, 150))
    }

    // Solo cachear (24h) un conteo COMPLETO. Si hubo fallos/429, devolver null sin cachear
    // para reintentar en la próxima visita (evita clavar un 0 o parcial por 24h).
    if (partial) return null
    await sb.from('system_cache').upsert({
      key: cacheKey,
      value: String(total),
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
    })
    return total
  } catch {
    return null
  }
}

export async function getOperationsFacts(
  sb: any,
  property: { id: string; bedrooms: number | null },
  monthKey: string, // YYYY-MM
  checkouts: number,
): Promise<OperationsFacts> {
  const [y, m] = monthKey.split('-').map(Number)
  const monthStart = `${monthKey}-01`
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const [{ count: limpiezas }, mensajes] = await Promise.all([
    sb.from('cx_limpieza')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', property.id)
      .gte('service_date', monthStart)
      .lt('service_date', nextMonth)
      .eq('estado', 'activa')
      .then((r: any) => r, () => ({ count: 0 })),
    countHostMessages(sb, property.id, monthStart, nextMonth),
  ])

  return {
    mensajes,
    limpiezas: limpiezas ?? 0,
    camas: (property.bedrooms ?? 0) * checkouts,
  }
}

export interface OwnerOpsFacts {
  mensajes: number | null
  limpiezas: number
  camas: number
  incidencias: number
}

/** Agregado del mes en curso para TODAS las propiedades del owner (pestaña Equipo NOK). */
export async function getOwnerOperationsFacts(
  sb: any,
  properties: { id: string; bedrooms: number | null }[],
  monthKey: string,
): Promise<OwnerOpsFacts> {
  const ids = properties.map(p => p.id)
  if (!ids.length) return { mensajes: null, limpiezas: 0, camas: 0, incidencias: 0 }
  const [y, m] = monthKey.split('-').map(Number)
  const monthStart = `${monthKey}-01`
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`

  const [limpRes, coRes, incRes] = await Promise.all([
    sb.from('cx_limpieza').select('id', { count: 'exact', head: true })
      .in('property_id', ids).gte('service_date', monthStart).lt('service_date', nextMonth).eq('estado', 'activa')
      .then((r: any) => r, () => ({ count: 0 })),
    sb.from('reservations').select('property_id')
      .in('property_id', ids).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_out', monthStart).lt('check_out', nextMonth),
    sb.from('cx_incidencias').select('id', { count: 'exact', head: true })
      .in('property_id', ids).gte('guesty_created_at', monthStart).lt('guesty_created_at', nextMonth)
      .neq('status', 'descartada')
      .then((r: any) => r, () => ({ count: 0 })),
  ])

  const coByProp = new Map<string, number>()
  for (const r of coRes.data ?? []) coByProp.set(r.property_id, (coByProp.get(r.property_id) ?? 0) + 1)
  const camas = properties.reduce((s2, p2) => s2 + (p2.bedrooms ?? 0) * (coByProp.get(p2.id) ?? 0), 0)

  // Mensajes solo para owners con pocas unidades (protege el rate limit de Guesty; cache 24h por unidad)
  let mensajes: number | null = null
  if (ids.length <= 5) {
    let total = 0, ok = true
    for (const pid of ids) {
      const c = await countHostMessages(sb, pid, monthStart, nextMonth)
      if (c == null) { ok = false; break }
      total += c
    }
    mensajes = ok ? total : null
  }

  return { mensajes, limpiezas: limpRes.count ?? 0, camas, incidencias: incRes.count ?? 0 }
}
