import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import Link from 'next/link'

interface Props {
  params: Promise<{ propertyId: string }>
}

function Stars({ score }: { score: number }) {
  const full = Math.floor(score)
  const half = score - full >= 0.5
  return (
    <span className="text-sm" style={{ color: '#D6A700' }}>
      {'★'.repeat(full)}
      {half ? '½' : ''}
      {'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  )
}

function ScoreBar({ label, value }: { label: string; value: number | null }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-28 shrink-0" style={{ color: 'rgba(26,26,26,0.45)' }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}>
        <div
          className="h-1.5 rounded-full"
          style={{ width: `${(value / 5) * 100}%`, backgroundColor: '#D6A700' }}
        />
      </div>
      <span className="font-medium w-8 text-right text-[#1A1A1A]">{value.toFixed(1)}</span>
    </div>
  )
}

export default async function ReviewsPage({ params }: Props) {
  const { propertyId } = await params

  const { property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const { data: reviews } = await sb
    .from('reviews')
    .select('*')
    .eq('property_id', propertyId)
    .gte('overall_score', 4)
    .order('submitted_at', { ascending: false })
    .limit(30)

  const allReviews = reviews ?? []
  const avgOverall = allReviews.length
    ? allReviews.reduce((s: number, r: any) => s + (r.overall_score ?? 0), 0) / allReviews.length
    : null

  return (
    <div className="px-8 lg:px-16 py-10 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">Reseñas</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>{property.name}</p>
        </div>
        <Link
          href={`/dashboard/${propertyId}/chat`}
          className="text-sm px-4 py-2 rounded-xl transition-all duration-200"
          style={{
            color: '#833B0E',
            border: '1px solid rgba(131, 59, 14,0.3)',
            backgroundColor: 'rgba(131, 59, 14,0.08)',
          }}
        >
          Pregúntale a NOK AI
        </Link>
      </div>

      {/* Summary card */}
      {avgOverall && (
        <div className="rounded-2xl p-6 mb-6 nok-card flex items-center gap-8">
          <div className="text-center">
            <p className="font-serif text-6xl font-light text-[#1A1A1A]">{avgOverall.toFixed(2)}</p>
            <Stars score={avgOverall} />
            <p className="text-xs mt-2" style={{ color: 'rgba(26,26,26,0.3)' }}>{allReviews.length} reseñas</p>
          </div>
          <div className="flex-1 space-y-2.5">
            <ScoreBar label="Limpieza" value={avgScore(allReviews, 'cleanliness_score')} />
            <ScoreBar label="Comunicación" value={avgScore(allReviews, 'communication_score')} />
            <ScoreBar label="Check-in" value={avgScore(allReviews, 'checkin_score')} />
            <ScoreBar label="Exactitud" value={avgScore(allReviews, 'accuracy_score')} />
            <ScoreBar label="Ubicación" value={avgScore(allReviews, 'location_score')} />
            <ScoreBar label="Valor" value={avgScore(allReviews, 'value_score')} />
          </div>
        </div>
      )}

      {/* Reviews list */}
      {allReviews.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center nok-card"
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'rgba(131, 59, 14,0.1)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(185,181,220,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>
          <p className="text-sm mb-2" style={{ color: 'rgba(26,26,26,0.4)' }}>
            No hay reseñas sincronizadas todavía.
          </p>
          <p className="text-xs" style={{ color: 'rgba(26,26,26,0.25)' }}>
            Sincroniza desde el calendario para importar reseñas de Guesty.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {allReviews.map((review: any) => (
            <div key={review.id} className="rounded-2xl p-5 nok-card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium text-[#1A1A1A] text-sm">{review.guest_name ?? 'Huésped'}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.35)' }}>
                    {review.submitted_at
                      ? new Date(review.submitted_at).toLocaleDateString('es-DO', { month: 'long', day: 'numeric', year: 'numeric' })
                      : ''}
                    {review.channel && ` · ${review.channel}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {review.overall_score && (
                    <span className="text-sm font-semibold text-[#1A1A1A]">
                      {(review.overall_score as number).toFixed(1)}
                    </span>
                  )}
                  {review.overall_score && <Stars score={review.overall_score as number} />}
                </div>
              </div>

              {review.reviewer_text && (
                <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.7)' }}>
                  {review.reviewer_text as string}
                </p>
              )}

              {review.host_response && (
                <div
                  className="mt-4 pl-4 py-2"
                  style={{ borderLeft: '2px solid rgba(131, 59, 14,0.4)' }}
                >
                  <p className="text-xs mb-1" style={{ color: '#833B0E' }}>Respuesta de NOK</p>
                  <p className="text-xs" style={{ color: 'rgba(26,26,26,0.55)' }}>
                    {review.host_response as string}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function avgScore(reviews: Record<string, unknown>[], field: string): number | null {
  const vals = reviews
    .map(r => r[field] as number | null)
    .filter((v): v is number => v !== null && v > 0)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}
