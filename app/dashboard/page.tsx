import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const serviceSupabase = createServiceClient()
  const { data: owner } = await serviceSupabase
    .from('owners')
    .select('*, properties(*)')
    .eq('supabase_user_id', user.id)
    .single()

  const properties = (owner?.properties ?? []).filter((p: { active: boolean }) => p.active)

  // Edificio (un propietario, N unidades): landing preferido si el owner tiene uno
  if (owner?.id) {
    let firstBuildingId: string | null = null
    try {
      const { listOwnerBuildings } = await import('@/lib/edificio')
      const { isAdminEmail } = await import('@/lib/admin')
      if (!isAdminEmail(owner.email)) {
        const buildings = await listOwnerBuildings(serviceSupabase as any, owner, false)
        firstBuildingId = buildings[0]?.id ?? null
      }
    } catch { firstBuildingId = null }
    if (firstBuildingId) redirect(`/dashboard/edificio/${firstBuildingId}/overview`)
  }

  // If owner has groups, prefer the first group as landing
  if (owner?.id) {
    const { data: groups } = await (serviceSupabase as any)
      .from('owner_property_groups')
      .select('id')
      .eq('owner_id', owner.id)
      .eq('active', true)
      .order('name')
      .limit(1)
    if (groups && groups.length > 0) {
      redirect(`/dashboard/group/${groups[0].id}/overview`)
    }
  }

  if (properties.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">No hay propiedades asignadas a tu cuenta.</p>
      </div>
    )
  }

  // Redirect to first property overview
  redirect(`/dashboard/${properties[0].id}/overview`)
}
