import Link from 'next/link'
import { loadOwnerBuilding } from '@/lib/edificio'
import { normalizeChannel, overlapNights, monthLabel } from '@/lib/building-pnl'
import { todayYmd } from '@/lib/ai/building-briefing'
import UnitFilter from '@/components/edificio/UnitFilter'
import MonthFilter from '@/components/edificio/MonthFilter'

interface Props {
  params: Promise<{ configId: string }>
  searchParams: Promise<{ unit?: string; month?: string }>
}

export const revalidate = 0

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  confirmed:    { label: 'Confirmada', color: 'bg-green-100 text-green-700' },
  checked_in:   { label: 'En casa', color: 'bg-blue-100 text-blue-700' },
  checked_out:  { label: 'Completada', color: 'bg-gray-100 text-gray-600' },
  cancelled:    { label: 'Cancelada', color: 'bg-red-100 text-red-700' },
  canceled:     { label: 'Cancelada', color: 'bg-red-100 text-red-700' },
  inquiry:      { label: 'Consulta', color: 'bg-yellow-100 text-yellow-700' },
}

const CHANNEL_PILL: Record<string, string> = {
  'Airbnb': 'bg-red-50 text-[#C81E3C]',
  'Booking.com': 'bg-sky-50 text-[#01679E]',
  'Vrbo': 'bg-violet-50 text-[#4D439E]',
  'Directo': 'bg-emerald-50 text-[#0E6845]',
  'NOK.rent': 'bg-emerald-50 text-[#0E6845]',
}

const EXCLUDED = '(canceled,cancelled,declined,expired,inquiry)'

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function fmtMoney(n: number | null | undefined, currency: string | null | undefined) {
  if (n == null) return '—'
  try {
    return new Intl.NumberFormat(currency === 'COP' ? 'es-CO' : 'en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${Math.round(n)} ${currency ?? ''}`
  }
}

export default async function EdificioReservasPage({ params, searchParams }: Props) {
  const { configId } = await params
  const sp = await searchParams
  const { config, properties, propertyIds, sb } = await loadOwnerBuilding(configId)

  const today = todayYmd()
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? (sp.month as string) : today.slice(0, 7)
  const unit = sp.unit && propertyIds.includes(sp.unit) ? sp.unit : null
  const ids = unit ? [unit] : propertyIds
  const idList = ids.length ? ids : ['00000000-0000-0000-0000-000000000000']
  const nameOf: Record<string, string> = Object.fromEntries(properties.map(p => [p.id, p.name]))

  const [y, m] = month.split('-').map(Number)
  const mStart = `${month}-01`
  const mEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const SELECT = 'id, property_id, check_in, check_out, nights, status, channel, guest_name, num_guests, owner_revenue, currency, is_blocked'

  const [homeRes, upcomingRes, pastRes, monthRes] = await Promise.all([
    sb.from('reservations').select(SELECT).in('property_id', idList)
      .not('status', 'in', EXCLUDED).lte('check_in', today).gt('check_out', today)
      .order('check_out', { ascending: true }).limit(60),
    sb.from('reservations').select(SELECT).in('property_id', idList)
      .not('status', 'in', EXCLUDED).gt('check_in', today)
      .order('check_in', { ascending: true }).limit(60),
    sb.from('reservations').select(SELECT).in('property_id', idList)
      .not('status', 'in', '(inquiry)').lte('check_out', today)
      .order('check_out', { ascending: false }).limit(40),
    sb.from('reservations').select('property_id, check_in, check_out, nights, status, is_blocked').in('property_id', idList)
      .not('status', 'in', EXCLUDED).lte('check_in', mEnd).gt('check_out', mStart).limit(2000),
  ])

  const noBlocks = (rows: any[] | null) => (rows ?? []).filter((r: any) => r.is_blocked !== true)
  const home = noBlocks(homeRes.data)
  const upcoming = noBlocks(upcomingRes.data)
  const past = noBlocks(pastRes.data)
  const monthRows = noBlocks(monthRes.data)

  const summary = {
    reservas: monthRows.length,
    noches: monthRows.reduce((s: number, r: any) => s + overlapNights(r.check_in, r.check_out, mStart, mEnd), 0),
    checkIns: monthRows.filter((r: any) => r.check_in >= mStart && r.check_in <= mEnd).length,
    checkOuts: monthRows.filter((r: any) => r.check_out >= mStart && r.check_out <= mEnd).length,
  }

  const Row = ({ r, muted = false }: { r: any; muted?: boolean }) => {
    const st = STATUS_LABELS[r.status] ?? { label: r.status, color: 'bg-gray-100 text-gray-600' }
    const ch = normalizeChannel(r.channel)
    return (
      <div
        className={`rounded-xl px-4 sm:px-5 py-3.5 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 ${muted ? 'opacity-70' : ''}`}
        style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}
      >
        <div className="w-full sm:w-auto sm:min-w-[120px] shrink-0">
          <Link href={`/dashboard/${r.property_id}/reservations`} className="text-sm font-semibold hover:underline" style={{ color: '#833B0E' }}>
            {nameOf[r.property_id] ?? '—'}
          </Link>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#1A1A1A] font-medium truncate">{r.guest_name || 'Huésped'}{r.num_guests ? <span className="font-normal" style={{ color: 'rgba(26,26,26,0.4)' }}> · {r.num_guests} pers.</span> : null}</p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
            {fmtDate(r.check_in)} → {fmtDate(r.check_out)}{r.nights ? ` · ${r.nights} ${r.nights === 1 ? 'noche' : 'noches'}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full ${CHANNEL_PILL[ch] ?? 'bg-[#1A1A1A]/5 text-[#1A1A1A]/60'}`}>{ch}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
        </div>
        <div className="shrink-0 text-right min-w-[72px] ml-auto sm:ml-0">
          <p className="text-sm font-semibold" style={{ color: r.owner_revenue ? '#0E6845' : 'rgba(26,26,26,0.3)' }}>{fmtMoney(r.owner_revenue, r.currency)}</p>
        </div>
      </div>
    )
  }

  const Section = ({ title, rows, empty, muted }: { title: string; rows: any[]; empty: string; muted?: boolean }) => (
    <section className="mb-8">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'rgba(26,26,26,0.5)' }}>{title} <span className="font-normal" style={{ color: 'rgba(26,26,26,0.3)' }}>({rows.length})</span></h2>
      {rows.length === 0
        ? <p className="text-sm" style={{ color: 'rgba(26,26,26,0.3)' }}>{empty}</p>
        : <div className="space-y-2">{rows.map((r: any) => <Row key={r.id} r={r} muted={muted} />)}</div>}
    </section>
  )

  return (
    <div className="px-5 sm:px-8 lg:px-16 py-8 sm:py-10 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-3xl sm:text-4xl text-[#1A1A1A] mb-1">Reservas — {config.name}</h1>
          <p className="text-sm" style={{ color: 'rgba(26,26,26,0.5)' }}>{properties.length} unidades{unit ? ` · filtrando ${nameOf[unit]}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <UnitFilter units={properties.map(p => ({ id: p.id, name: p.name }))} value={unit} />
          <MonthFilter value={month} />
        </div>
      </div>

      {/* Resumen del mes */}
      <div className="rounded-xl px-5 py-4 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-4" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
        {[
          { label: 'Reservas', value: summary.reservas },
          { label: 'Noches', value: summary.noches },
          { label: 'Check-ins', value: summary.checkIns },
          { label: 'Check-outs', value: summary.checkOuts },
        ].map(s => (
          <div key={s.label}>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.35)' }}>{s.label}</p>
            <p className="font-serif text-2xl text-[#1A1A1A]">{s.value}</p>
          </div>
        ))}
        <p className="col-span-2 sm:col-span-4 text-xs -mt-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{monthLabel(month)}{unit ? ` · ${nameOf[unit]}` : ' · todo el edificio'}</p>
      </div>

      <Section title="En casa hoy" rows={home} empty="Ninguna unidad ocupada hoy." />
      <Section title="Próximas" rows={upcoming} empty="No hay reservas próximas." />
      <Section title="Recientes" rows={past} empty="Sin reservas recientes." muted />
    </div>
  )
}
