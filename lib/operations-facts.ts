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
    for (const r of monthRes ?? []) {
      try {
        const resp = await fetch(`${G}/reservations/${r.guesty_reservation_id}?fields=conversationId`, { headers: H, cache: 'no-store' })
        if (!resp.ok) continue
        const { conversationId } = await resp.json()
        if (!conversationId) continue
        const pResp = await fetch(`${G}/communication/conversations/${conversationId}/posts?limit=100`, { headers: H, cache: 'no-store' })
        if (!pResp.ok) continue
        const pData = await pResp.json()
        const posts = pData.data?.posts || pData.posts || (Array.isArray(pData.data) ? pData.data : [])
        total += posts.filter((p: any) =>
          p.sentBy === 'host' && p.createdAt >= monthStart && p.createdAt < monthEndExclusive
        ).length
      } catch { /* una conversación caída no tumba el conteo */ }
      await new Promise(res => setTimeout(res, 150))
    }

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
