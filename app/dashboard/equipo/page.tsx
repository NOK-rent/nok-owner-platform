import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import EquipoClient from '@/components/equipo/EquipoClient'
import { getOwnerOperationsFacts } from '@/lib/operations-facts'

export const dynamic = 'force-dynamic'

export default async function EquipoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = createServiceClient() as any
  const { data: owner } = await sb
    .from('owners')
    .select('id, name, email')
    .eq('supabase_user_id', user.id)
    .single()
  if (!owner) redirect('/login')

  const isAdmin = isAdminEmail(owner.email)

  const propsQuery = sb.from('properties').select('id, name, bedrooms').eq('active', true).order('name')
  const [propertiesRes, ticketsRes, notificationsRes, workItemsRes] = await Promise.all([
    isAdmin ? propsQuery : propsQuery.eq('owner_id', owner.id),
    sb.from('support_tickets')
      .select('id, title, status, area_responsable, apartamento, property_id, urgencia, created_at, updated_at, last_owner_message_at, last_team_message_at')
      .eq('owner_id', owner.id)
      .order('updated_at', { ascending: false })
      .limit(100),
    sb.from('owner_notifications')
      .select('id, type, title, body, link_url, link_label, attachments, is_read, created_at')
      .eq('owner_id', owner.id)
      .order('created_at', { ascending: false })
      .limit(50),
    sb.from('owner_work_items')
      .select('id, tipo, titulo, descripcion, valor_usd, pdf_url, fotos, status, fecha_programada, created_at, properties(name)')
      .eq('owner_id', owner.id)
      .neq('status', 'borrador')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const now = new Date()
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const ownProps = isAdmin ? [] : ((propertiesRes.data ?? []) as { id: string; bedrooms?: number | null }[])
  const opsFacts = await getOwnerOperationsFacts(
    sb,
    ownProps.map(p => ({ id: p.id, bedrooms: (p as any).bedrooms ?? null })),
    monthKey,
  )

  // Firma los adjuntos del bucket privado antes de pasarlos al cliente (1h)
  const { signAttachments, signAttachmentPath } = await import('@/lib/soporte')
  const notifications = await Promise.all(((notificationsRes.data ?? []) as any[]).map(async n => ({
    ...n,
    attachments: Array.isArray(n.attachments) ? await signAttachments(sb, n.attachments, 3600) : n.attachments,
  })))
  const workItems = await Promise.all(((workItemsRes.data ?? []) as any[]).map(async w => ({
    ...w,
    pdf_url: w.pdf_url ? await signAttachmentPath(sb, w.pdf_url, 3600) : null,
    fotos: Array.isArray(w.fotos) ? await signAttachments(sb, w.fotos, 3600) : w.fotos,
  })))

  return (
    <EquipoClient
      ownerName={owner.name}
      properties={propertiesRes.data ?? []}
      initialTickets={ticketsRes.data ?? []}
      notifications={notifications}
      initialWorkItems={workItems}
      opsFacts={opsFacts}
    />
  )
}
