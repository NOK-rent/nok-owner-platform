import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import TopNav from '@/components/dashboard/TopNav'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const serviceSupabase = createServiceClient()
  const { data: owner } = await (serviceSupabase as any)
    .from('owners')
    .select('*, properties(*)')
    .eq('supabase_user_id', user.id)
    .single()

  if (!owner) redirect('/login')

  // Admin can see ALL properties across all owners
  const { isAdminEmail } = await import('@/lib/admin')
  const isAdmin = isAdminEmail(owner.email)

  let properties: any[]
  if (isAdmin) {
    const { data: allProps } = await (serviceSupabase as any)
      .from('properties')
      .select('*')
      .eq('active', true)
      .order('name')
    properties = allProps ?? []
  } else {
    properties = (owner.properties ?? []).filter((p: { active: boolean }) => p.active)
  }

  // Fetch owner groups (admins see all, owners see only their own)
  let groups: any[] = []
  try {
    let gQuery = (serviceSupabase as any)
      .from('owner_property_groups')
      .select('id, name, owner_id, active')
      .eq('active', true)
    if (!isAdmin) gQuery = gQuery.eq('owner_id', owner.id)
    const { data: gs } = await gQuery.order('name')
    groups = gs ?? []
  } catch { groups = [] }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F0EFED' }}>
      <TopNav owner={owner} properties={properties} groups={groups} />
      <main className="pt-16 min-w-0">
        {children}
      </main>
    </div>
  )
}
