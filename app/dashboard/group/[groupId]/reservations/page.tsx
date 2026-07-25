import { loadOwnerGroup } from '@/lib/group'

interface Props { params: Promise<{ groupId: string }> }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  confirmed:    { label: 'Confirmada', color: 'bg-green-100 text-green-700' },
  checked_in:   { label: 'En casa', color: 'bg-blue-100 text-blue-700' },
  checked_out:  { label: 'Completada', color: 'bg-gray-100 text-gray-600' },
  cancelled:    { label: 'Cancelada', color: 'bg-red-100 text-red-700' },
  inquiry:      { label: 'Consulta', color: 'bg-yellow-100 text-yellow-700' },
}

export default async function GroupReservations({ params }: Props) {
  const { groupId } = await params
  const { group, propertyIds, properties, sb } = await loadOwnerGroup(groupId)
  const propMap: Record<string, any> = Object.fromEntries(properties.map((p: any) => [p.id, p]))
  const today = new Date().toISOString().split('T')[0]

  const idList = propertyIds.length ? propertyIds : ['00000000-0000-0000-0000-000000000000']
  const [upcomingRes, pastRes] = await Promise.all([
    sb.from('reservations').select('*').in('property_id', idList)
      .gte('check_in', today).neq('status', 'cancelled')
      .order('check_in', { ascending: true }).limit(40),
    sb.from('reservations').select('*').in('property_id', idList)
      .lt('check_in', today).order('check_in', { ascending: false }).limit(30),
  ])

  const fmt = (d: string) => new Date(d).toLocaleDateString('es-DO', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="px-8 lg:px-16 py-10 max-w-4xl">
      <h1 className="font-serif text-4xl text-[#1A1A1A] mb-1">Reservas — Grupo: {group.name}</h1>
      <p className="text-sm text-[#1A1A1A]/50 mb-8">{properties.length} propiedades</p>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-[#1A1A1A]/50 uppercase tracking-wide mb-3">Próximas reservas</h2>
        {(upcomingRes.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-[#1A1A1A]/30">No hay reservas próximas.</p>
        ) : (
          <div className="space-y-2">
            {upcomingRes.data!.map((r: any) => {
              const st = STATUS_LABELS[r.status] ?? { label: r.status, color: 'bg-gray-100 text-gray-600' }
              return (
                <div key={r.id} className="rounded-xl px-5 py-4 flex items-center gap-4" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#1A1A1A] font-medium text-sm">{r.guest_name ?? 'Huésped'}</p>
                    <p className="text-xs text-[#1A1A1A]/40 mt-0.5">
                      {propMap[r.property_id]?.name ?? '—'} · {fmt(r.check_in)} → {fmt(r.check_out)}
                      {r.nights ? ` · ${r.nights} noches` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.channel && <span className="text-xs bg-[#1A1A1A]/5 text-[#1A1A1A]/60 px-2 py-0.5 rounded-full">{r.channel}</span>}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                  </div>
                  {r.owner_revenue != null && (
                    <div className="text-right shrink-0">
                      <p className="text-sm text-[#1A1A1A] font-semibold">
                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency ?? 'USD', maximumFractionDigits: 0 }).format(r.owner_revenue)}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {(pastRes.data?.length ?? 0) > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-[#1A1A1A]/50 uppercase tracking-wide mb-3">Reservas recientes</h2>
          <div className="space-y-2">
            {pastRes.data!.map((r: any) => (
              <div key={r.id} className="rounded-xl px-5 py-4 flex items-center gap-4 opacity-70" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-[#1A1A1A] text-sm">{r.guest_name ?? 'Huésped'}</p>
                  <p className="text-xs text-[#1A1A1A]/40 mt-0.5">
                    {propMap[r.property_id]?.name ?? '—'} · {fmt(r.check_in)} → {fmt(r.check_out)}
                    {r.channel ? ` · ${r.channel}` : ''}
                  </p>
                </div>
                {r.owner_revenue != null && (
                  <p className="text-sm text-[#1A1A1A]/80">
                    {new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency ?? 'USD', maximumFractionDigits: 0 }).format(r.owner_revenue)}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
