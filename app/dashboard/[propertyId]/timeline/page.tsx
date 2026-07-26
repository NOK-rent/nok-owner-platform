import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import { getTimeline, type TimelineEvent } from '@/lib/owner-insights'
import { getLocale } from '@/lib/i18n'

interface Props {
  params: Promise<{ propertyId: string }>
}

export const revalidate = 0

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWhen(iso: string, en: boolean) {
  const d = new Date(iso)
  const day = d.getDate(), m = d.getMonth()
  return en ? `${MONTHS[m]} ${day}` : `${day} ${MESES[m]}`
}

function fmtUsd(n: number) {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function EventRow({ e, en }: { e: TimelineEvent; en: boolean }) {
  let icon = '•', color = '#0080C6', title = '', detail = ''
  if (e.type === 'booking') {
    icon = '✓'; color = '#0E6845'
    title = en
      ? `New booking — ${e.data.nights} night${e.data.nights === 1 ? '' : 's'} · ${fmtUsd(e.data.amount)}`
      : `Nueva reserva — ${e.data.nights} noche${e.data.nights === 1 ? '' : 's'} · ${fmtUsd(e.data.amount)}`
    detail = en
      ? `${e.data.guest ?? 'Guest'} · check-in ${fmtWhen(e.data.checkIn + 'T12:00:00', en)}${e.data.channel ? ` · ${e.data.channel}` : ''}`
      : `${e.data.guest ?? 'Huésped'} · check-in ${fmtWhen(e.data.checkIn + 'T12:00:00', en)}${e.data.channel ? ` · ${e.data.channel}` : ''}`
  } else if (e.type === 'review') {
    icon = '★'; color = e.milestone ? '#D6A700' : '#B9B5DC'
    title = en
      ? `New review — ${e.data.score != null ? `${Number(e.data.score).toFixed(1)}/5` : 'received'}`
      : `Nueva reseña — ${e.data.score != null ? `${Number(e.data.score).toFixed(1)}/5` : 'recibida'}`
    detail = e.data.excerpt ? `“${e.data.excerpt}${e.data.excerpt.length >= 140 ? '…' : ''}”` : (e.data.guest ?? '')
  } else {
    icon = '⇅'; color = '#833B0E'
    const { count, up, down } = e.data
    title = en
      ? `Revenue Management adjusted ${count} nightly rate${count === 1 ? '' : 's'}`
      : `Revenue Management ajustó ${count} tarifa${count === 1 ? '' : 's'}`
    detail = en
      ? `${up} up · ${down} down — reacting to demand in your area`
      : `${up} al alza · ${down} a la baja — reaccionando a la demanda de tu zona`
  }
  return (
    <div className="flex gap-4 py-4" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm"
        style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}40` }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-[#1A1A1A]">{title}</p>
          <p className="text-xs whitespace-nowrap" style={{ color: 'rgba(26,26,26,0.35)' }}>{fmtWhen(e.date, en)}</p>
        </div>
        {detail && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(26,26,26,0.5)' }}>{detail}</p>}
      </div>
    </div>
  )
}

export default async function TimelinePage({ params }: Props) {
  const { propertyId } = await params
  const { property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()
  const locale = await getLocale()
  const en = locale === 'en'

  const events = await getTimeline(sb, propertyId, 30)

  return (
    <div className="min-h-screen pt-16" style={{ backgroundColor: '#F0EFED' }}>
      <div className="max-w-3xl mx-auto px-6 lg:px-10 py-10">
        <p className="text-xs uppercase tracking-[0.2em] mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
          {en ? 'Activity' : 'Actividad'}
        </p>
        <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">
          {en ? `What's happening with ${property.name}` : `Qué está pasando con ${property.name}`}
        </h1>
        <p className="text-sm mt-2 mb-8" style={{ color: 'rgba(26,26,26,0.45)' }}>
          {en
            ? 'Everything the NOK team and engine did for your unit, in one feed: bookings, reviews and rate adjustments.'
            : 'Todo lo que el equipo y el motor de NOK hacen por tu unidad, en un solo feed: reservas, reseñas y ajustes de tarifa.'}
        </p>

        <div className="rounded-2xl px-6 py-2 nok-card">
          {events.length === 0 ? (
            <p className="text-sm py-6" style={{ color: 'rgba(26,26,26,0.5)' }}>
              {en ? 'No recent activity yet — new bookings, reviews and rate adjustments will appear here.' : 'Aún no hay actividad reciente — las nuevas reservas, reseñas y ajustes de tarifa van a aparecer aquí.'}
            </p>
          ) : (
            events.map((e, i) => <EventRow key={i} e={e} en={en} />)
          )}
        </div>

        <p className="text-xs mt-6" style={{ color: 'rgba(26,26,26,0.3)' }}>
          {en ? 'Last 90 days of activity. Rate adjustments are grouped per day.' : 'Últimos 90 días de actividad. Los ajustes de tarifa se agrupan por día.'}
        </p>
      </div>
    </div>
  )
}
