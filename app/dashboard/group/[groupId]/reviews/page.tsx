import { loadOwnerGroup } from '@/lib/group'

interface Props { params: Promise<{ groupId: string }> }

function Stars({ score }: { score: number }) {
  const full = Math.floor(score)
  const half = score - full >= 0.5
  return (
    <span className="text-sm" style={{ color: '#D6A700' }}>
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  )
}

function avg(rows: any[], field: string): number | null {
  const vals = rows.map((r) => r[field] as number | null).filter((v): v is number => v != null && v > 0)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0" style={{ color: 'rgba(26,26,26,0.45)' }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}>
        <div className="h-1.5 rounded-full" style={{ width: `${(value / 5) * 100}%`, backgroundColor: '#D6A700' }} />
      </div>
      <span className="font-medium w-8 text-right text-[#1A1A1A]">{value.toFixed(1)}</span>
    </div>
  )
}

export default async function GroupReviews({ params }: Props) {
  const { groupId } = await params
  const { group, propertyIds, properties, sb } = await loadOwnerGroup(groupId)
  const idList = propertyIds.length ? propertyIds : ['00000000-0000-0000-0000-000000000000']
  const propMap: Record<string, any> = Object.fromEntries(properties.map((p: any) => [p.id, p]))

  const { data: reviews } = await sb
    .from('reviews').select('*').in('property_id', idList)
    .gte('overall_score', 4)
    .order('submitted_at', { ascending: false }).limit(60)

  const all = reviews ?? []
  const avgOverall = all.length ? all.reduce((s: number, r: any) => s + (r.overall_score ?? 0), 0) / all.length : null

  return (
    <div className="px-8 lg:px-16 py-10 max-w-4xl">
      <h1 className="font-serif text-4xl text-[#1A1A1A] mb-1">Reseñas — Grupo: {group.name}</h1>
      <p className="text-sm text-[#1A1A1A]/50 mb-8">{properties.length} propiedades · {all.length} reseñas</p>

      {avgOverall && (
        <div className="rounded-2xl p-6 mb-6 flex items-center gap-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
          <div className="text-center">
            <p className="font-serif text-6xl font-light text-[#1A1A1A]">{avgOverall.toFixed(2)}</p>
            <Stars score={avgOverall} />
            <p className="text-xs mt-2 text-[#1A1A1A]/30">{all.length} reseñas</p>
          </div>
          <div className="flex-1 space-y-2.5">
            <ScoreBar label="Limpieza" value={avg(all, 'cleanliness_score')} />
            <ScoreBar label="Comunicación" value={avg(all, 'communication_score')} />
            <ScoreBar label="Check-in" value={avg(all, 'checkin_score')} />
            <ScoreBar label="Exactitud" value={avg(all, 'accuracy_score')} />
            <ScoreBar label="Ubicación" value={avg(all, 'location_score')} />
            <ScoreBar label="Valor" value={avg(all, 'value_score')} />
          </div>
        </div>
      )}

      {all.length === 0 ? (
        <p className="text-sm text-[#1A1A1A]/40">No hay reseñas todavía.</p>
      ) : (
        <div className="space-y-3">
          {all.map((r: any) => (
            <div key={r.id} className="rounded-2xl p-5" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium text-[#1A1A1A] text-sm">{r.guest_name ?? 'Huésped'}</p>
                  <p className="text-xs mt-0.5 text-[#1A1A1A]/35">
                    {propMap[r.property_id]?.name ?? '—'}
                    {r.submitted_at && ` · ${new Date(r.submitted_at).toLocaleDateString('es-DO', { month: 'long', day: 'numeric', year: 'numeric' })}`}
                    {r.channel && ` · ${r.channel}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.overall_score && <span className="text-sm font-semibold text-[#1A1A1A]">{(r.overall_score as number).toFixed(1)}</span>}
                  {r.overall_score && <Stars score={r.overall_score as number} />}
                </div>
              </div>
              {r.reviewer_text && <p className="text-sm leading-relaxed text-[#1A1A1A]/70">{r.reviewer_text as string}</p>}
              {r.host_response && (
                <div className="mt-4 pl-4 py-2" style={{ borderLeft: '2px solid rgba(131, 59, 14,0.4)' }}>
                  <p className="text-xs mb-1 text-[#833B0E]">Respuesta de NOK</p>
                  <p className="text-xs text-[#1A1A1A]/55">{r.host_response as string}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
