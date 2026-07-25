import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Owner-facing notifications API.
 *  GET                       → list this owner's notifications (optionally ?propertyId=&unread=1)
 *  PATCH { id }              → mark one as read
 *  PATCH { markAllRead:true }→ mark all of this owner's as read
 */

async function getOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', status: 401 as const }
  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, email').eq('supabase_user_id', user.id).single()
  if (!owner) return { error: 'Owner not found', status: 404 as const }
  return { owner, sb }
}

export async function GET(req: Request) {
  const ctx = await getOwner()
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { owner, sb } = ctx

  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')
  const unreadOnly = searchParams.get('unread') === '1'

  let q = sb
    .from('owner_notifications')
    .select('id, type, title, body, link_url, link_label, is_read, created_at, property_id')
    .eq('owner_id', owner.id)
    .order('created_at', { ascending: false })
    .limit(50)

  // Property-scoped + global (property_id IS NULL) notifications
  if (propertyId) q = q.or(`property_id.eq.${propertyId},property_id.is.null`)
  if (unreadOnly) q = q.eq('is_read', false)

  const { data, error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ notifications: data ?? [] })
}

export async function PATCH(req: Request) {
  const ctx = await getOwner()
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status })
  const { owner, sb } = ctx

  const body = await req.json().catch(() => ({}))
  const update = { is_read: true, read_at: new Date().toISOString() }

  let q = sb.from('owner_notifications').update(update).eq('owner_id', owner.id)
  if (body.markAllRead) {
    q = q.eq('is_read', false)
  } else if (body.id) {
    q = q.eq('id', body.id)
  } else {
    return Response.json({ error: 'id or markAllRead required' }, { status: 400 })
  }

  const { error } = await q
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
