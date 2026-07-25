import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import EquipoClient from '@/components/equipo/EquipoClient'

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

  const propsQuery = sb.from('properties').select('id, name').eq('active', true).order('name')
  const [propertiesRes, ticketsRes, notificationsRes] = await Promise.all([
    isAdmin ? propsQuery : propsQuery.eq('owner_id', owner.id),
    sb.from('support_tickets')
      .select('id, title, status, area_responsable, apartamento, property_id, urgencia, created_at, updated_at, last_owner_message_at, last_team_message_at')
      .eq('owner_id', owner.id)
      .order('updated_at', { ascending: false })
      .limit(100),
    sb.from('owner_notifications')
      .select('id, type, title, body, link_url, link_label, is_read, created_at')
      .eq('owner_id', owner.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  return (
    <EquipoClient
      ownerName={owner.name}
      properties={propertiesRes.data ?? []}
      initialTickets={ticketsRes.data ?? []}
      notifications={notificationsRes.data ?? []}
    />
  )
}
