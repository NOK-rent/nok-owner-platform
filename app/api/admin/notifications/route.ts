import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'

/**
 * Admin notifications API — send in-portal comunicados to owners.
 *  GET  → form data: list of owners (+ their properties)
 *  POST → create notification(s):
 *         { ownerId | broadcast:true, propertyId?, type, title, body, link_url?, link_label? }
 */

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const sb = createServiceClient() as any
  const { data: me } = await sb.from('owners').select('email').eq('supabase_user_id', user.id).single()
  if (!isAdminEmail(me?.email)) return { error: 'Forbidden', status: 403 as const }
  return { sb, adminEmail: me.email as string }
}

export async function GET() {
  const ctx = await requireAdmin()
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { sb } = ctx

  const { data: owners } = await sb
    .from('owners')
    .select('id, name, email, properties(id, name, active)')
    .order('name')

  return Response.json({ owners: owners ?? [] })
}

export async function POST(req: Request) {
  const ctx = await requireAdmin()
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { sb, adminEmail } = ctx

  const b = await req.json().catch(() => ({}))
  const { ownerId, broadcast, propertyId, type = 'info', title, body, link_url, link_label } = b

  if (!title || !body) return Response.json({ error: 'title y body son obligatorios' }, { status: 400 })
  const validType = ['info', 'success', 'warning', 'payment', 'urgent'].includes(type)
  if (!validType) return Response.json({ error: 'type inválido' }, { status: 400 })

  // Resolve target owner ids
  let ownerIds: string[] = []
  if (broadcast) {
    const { data: all } = await sb.from('owners').select('id')
    ownerIds = (all ?? []).map((o: { id: string }) => o.id)
  } else if (ownerId) {
    ownerIds = [ownerId]
  } else {
    return Response.json({ error: 'ownerId o broadcast requerido' }, { status: 400 })
  }

  const rows = ownerIds.map((oid) => ({
    owner_id: oid,
    property_id: broadcast ? null : propertyId || null,
    type,
    title,
    body,
    link_url: link_url || null,
    link_label: link_label || null,
    created_by: adminEmail,
  }))

  const { data, error } = await sb.from('owner_notifications').insert(rows).select('id')
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, sent: data?.length ?? 0 })
}
