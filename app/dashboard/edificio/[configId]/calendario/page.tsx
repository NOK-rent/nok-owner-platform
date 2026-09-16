import { loadOwnerBuilding } from '@/lib/edificio'
import { normalizeChannel } from '@/lib/building-pnl'
import { todayYmd, addDays } from '@/lib/ai/building-briefing'
import BuildingCalendar, { type CalendarCell, type CalendarUnit } from '@/components/edificio/BuildingCalendar'

interface Props {
  params: Promise<{ configId: string }>
  searchParams: Promise<{ month?: string; year?: string }>
}

export const revalidate = 0

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'H'
  return parts.slice(0, 2).map(p => p[0]!.toUpperCase()).join('')
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export default async function EdificioCalendarioPage({ params, searchParams }: Props) {
  const { configId } = await params
  const sp = await searchParams
  const { config, properties, propertyIds, sb } = await loadOwnerBuilding(configId)

  const now = new Date()
  const year = sp.year && /^\d{4}$/.test(sp.year) ? Number(sp.year) : now.getFullYear()
  const month = sp.month && /^\d{1,2}$/.test(sp.month) && Number(sp.month) >= 1 && Number(sp.month) <= 12 ? Number(sp.month) : now.getMonth() + 1
  const dim = new Date(year, month, 0).getDate()
  const pfx = `${year}-${String(month).padStart(2, '0')}-`
  const days = Array.from({ length: dim }, (_, i) => `${pfx}${String(i + 1).padStart(2, '0')}`)
  const from = days[0], to = days[dim - 1]
  const today = todayYmd()

  const idList = propertyIds.length ? propertyIds : ['00000000-0000-0000-0000-000000000000']
  const [resRes, pcRes, snapRes] = await Promise.all([
    sb.from('reservations')
      .select('id, property_id, check_in, check_out, nights, guest_name, channel, status, num_guests, is_blocked')
      .in('property_id', idList)
      .not('status', 'in', '(canceled,cancelled,declined,expired,inquiry)')
      .lte('check_in', to).gt('check_out', from).limit(3000),
    sb.from('pricing_calendar')
      .select('property_id, calendar_date, base_rate, is_blocked, currency')
      .in('property_id', idList).gte('calendar_date', from).lte('calendar_date', to).limit(5000),
    sb.from('rate_snapshots').select('property_id, prices').in('property_id', idList),
  ])

  // Índices por unidad: fecha → reserva / precio / bloqueo
  const resByUnit = new Map<string, Map<string, any>>()
  for (const r of (resRes.data ?? []) as any[]) {
    if (!resByUnit.has(r.property_id)) resByUnit.set(r.property_id, new Map())
    const m = resByUnit.get(r.property_id)!
    let cur = r.check_in < from ? from : r.check_in
    while (cur < r.check_out && cur <= to) { m.set(cur, r); cur = addDays(cur, 1) }
  }
  const priceByUnit = new Map<string, Map<string, number>>()
  const blockedByUnit = new Map<string, Set<string>>()
  let currency = 'USD'
  for (const s of (snapRes.data ?? []) as any[]) {
    const m = new Map<string, number>()
    for (const [d, v] of Object.entries(s.prices ?? {})) if (typeof v === 'number' && v > 0 && d.startsWith(pfx)) m.set(d, v)
    priceByUnit.set(s.property_id, m)
  }
  for (const p of (pcRes.data ?? []) as any[]) {
    if (p.is_blocked) {
      if (!blockedByUnit.has(p.property_id)) blockedByUnit.set(p.property_id, new Set())
      blockedByUnit.get(p.property_id)!.add(p.calendar_date)
    }
    if (p.base_rate > 0) {
      if (!priceByUnit.has(p.property_id)) priceByUnit.set(p.property_id, new Map())
      priceByUnit.get(p.property_id)!.set(p.calendar_date, Number(p.base_rate))
      if (p.currency) currency = p.currency
    }
  }

  const activeCount = properties.filter(p => p.active).length || 1
  const bookedPerDay = new Array<number>(dim).fill(0)
  const units: CalendarUnit[] = properties.map(p => {
    const rm = resByUnit.get(p.id)
    const pm = priceByUnit.get(p.id)
    const bl = blockedByUnit.get(p.id)
    let booked = 0
    const cells: CalendarCell[] = days.map((d, i) => {
      const r = rm?.get(d)
      if (r) {
        const lastNight = addDays(r.check_out, -1)
        const isBlock = r.is_blocked === true
        const s = d === r.check_in || d === from
        const e = d === lastNight || d === to
        if (isBlock) return { k: 'b', t: `Bloqueo · ${fmtDate(r.check_in)} → ${fmtDate(r.check_out)}` }
        booked++
        if (p.active) bookedPerDay[i]++
        const guest = r.guest_name || 'Huésped'
        return { k: 'r', ch: r.channel ?? null, ini: initials(r.guest_name), s, e, t: `${guest} · ${normalizeChannel(r.channel)} · ${fmtDate(r.check_in)} → ${fmtDate(r.check_out)}${r.nights ? ` · ${r.nights} noches` : ''}` }
      }
      if (bl?.has(d)) return { k: 'b', t: 'Bloqueado en el calendario' }
      return { k: 'f', p: pm?.get(d) ?? null }
    })
    return { id: p.id, name: p.name, active: p.active, cells, occupancy: Math.round((booked / dim) * 100) }
  })
  const dailyOccupancy = bookedPerDay.map(n => Math.round((n / activeCount) * 100))

  return (
    <div className="px-5 sm:px-8 lg:px-16 py-8 sm:py-10 max-w-7xl">
      <div className="mb-6">
        <h1 className="font-serif text-3xl sm:text-4xl font-light text-[#1A1A1A]">Calendario — {config.name}</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>{properties.length} unidades · ocupación por día de todo el edificio</p>
      </div>
      <BuildingCalendar
        configId={configId}
        year={year}
        month={month}
        days={days}
        units={units}
        dailyOccupancy={dailyOccupancy}
        currency={currency}
        today={today}
      />
    </div>
  )
}
