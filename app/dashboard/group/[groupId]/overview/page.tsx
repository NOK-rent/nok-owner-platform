import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { copToUSD, getUSDtoCOPRate } from '@/lib/trm'
import { isAdminEmail } from '@/lib/admin'
import MonthPills from '@/components/dashboard/MonthPills'

interface Props {
  params: Promise<{ groupId: string }>
  searchParams: Promise<{ month?: string }>
}

function fmt(amount: number | null, currency = 'USD') {
  if (amount === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
}

function prorateForMonth(ownerRevenue: number, nights: number, checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  if (nights <= 0 || ownerRevenue <= 0) return 0
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1)
  const overlapStart = ci > ms ? ci : ms
  const overlapEnd = co < me ? co : me
  const overlapDays = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / (1000*60*60*24)))
  if (overlapDays >= nights) return ownerRevenue
  return (ownerRevenue / nights) * overlapDays
}

function overlapNightsForMonth(checkIn: string, checkOut: string, monthStart: string, monthEnd: string): number {
  const ci = new Date(checkIn + 'T00:00:00')
  const co = new Date(checkOut + 'T00:00:00')
  const ms = new Date(monthStart + 'T00:00:00')
  const me = new Date(monthEnd + 'T00:00:00')
  me.setDate(me.getDate() + 1)
  const os = ci > ms ? ci : ms
  const oe = co < me ? co : me
  return Math.max(0, Math.round((oe.getTime() - os.getTime()) / (1000*60*60*24)))
}

export default async function GroupOverviewPage({ params, searchParams }: Props) {
  const { groupId } = await params
  const { month: monthParam } = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, name, email').eq('supabase_user_id', user.id).single()
  if (!owner) redirect('/login')
  const isAdmin = isAdminEmail(owner.email)

  // Load group
  let gQuery = sb.from('owner_property_groups').select('*').eq('id', groupId)
  if (!isAdmin) gQuery = gQuery.eq('owner_id', owner.id)
  const { data: group } = await gQuery.single()
  if (!group) notFound()

  // Members
  const { data: memberRows } = await sb
    .from('owner_property_group_members').select('property_id').eq('group_id', groupId)
  const propIds: string[] = (memberRows ?? []).map((m: any) => m.property_id)

  const { data: props } = await sb
    .from('properties')
    .select('id, name, nok_commission_rate, cleaning_fee, cleaning_fee_currency')
    .in('id', propIds.length ? propIds : ['00000000-0000-0000-0000-000000000000'])

  // Group-level costs
  const { data: groupCosts } = await sb
    .from('owner_property_group_costs').select('*').eq('group_id', groupId).order('date', { ascending: false })

  const now = new Date()
  const selectedMonthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [selYear, selMonth] = selectedMonthKey.split('-').map(Number)
  const displayYear = now.getFullYear()
  const yearStart = `${displayYear}-01-01`
  const monthStart = `${selectedMonthKey}-01`
  const monthEnd = `${selectedMonthKey}-${String(new Date(selYear, selMonth, 0).getDate()).padStart(2, '0')}`
  const daysInMonth = new Date(selYear, selMonth, 0).getDate()
  const ytdMonthKeys: string[] = []
  for (let m = 1; m <= now.getMonth() + 1; m++) ytdMonthKeys.push(`${displayYear}-${String(m).padStart(2, '0')}`)

  const propIdArr = propIds.length ? propIds : ['00000000-0000-0000-0000-000000000000']

  const [monthResRes, ytdResRes, monthUtilRes, ytdUtilRes, monthMaintRes, ytdMaintRes] = await Promise.all([
    sb.from('reservations').select('property_id, owner_revenue, nights, currency, check_in, check_out, channel')
      .in('property_id', propIdArr).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', monthEnd).gt('check_out', monthStart),
    sb.from('reservations').select('property_id, owner_revenue, nights, currency, check_in, check_out, channel')
      .in('property_id', propIdArr).in('status', ['confirmed', 'checked_in', 'checked_out'])
      .gte('check_in', yearStart),
    sb.from('utility_costs').select('property_id, amount, currency, month').in('property_id', propIdArr).eq('month', selectedMonthKey),
    sb.from('utility_costs').select('property_id, amount, currency, month').in('property_id', propIdArr).in('month', ytdMonthKeys),
    sb.from('maintenance_costs').select('property_id, amount, currency, date').in('property_id', propIdArr).gte('date', monthStart).lte('date', monthEnd),
    sb.from('maintenance_costs').select('property_id, amount, currency, date').in('property_id', propIdArr).gte('date', yearStart),
  ])

  const trm = await getUSDtoCOPRate()
  const toUSD = (amount: number, currency: string | null | undefined) =>
    (currency || 'USD').toUpperCase() === 'COP' ? amount / trm : amount

  const isDirect = (ch: string | null | undefined) => {
    const c = (ch ?? '').toLowerCase()
    return c.includes('direct') || c === 'owner' || c === 'manual' || c.includes('website')
  }
  const DIRECT_RATE = 0.10
  const propMap: Record<string, any> = Object.fromEntries((props ?? []).map((p: any) => [p.id, p]))

  // Per-property aggregates (month)
  type Agg = { name: string; gross: number; nights: number; commission: number; cleaning: number; direct: number; utilities: number; maintenance: number; net: number; checkouts: number }
  const perProp: Record<string, Agg> = {}
  for (const p of props ?? []) {
    perProp[p.id] = { name: p.name, gross: 0, nights: 0, commission: 0, cleaning: 0, direct: 0, utilities: 0, maintenance: 0, net: 0, checkouts: 0 }
  }

  for (const r of monthResRes.data ?? []) {
    const a = perProp[r.property_id]; if (!a) continue
    const gross = prorateForMonth(toUSD(r.owner_revenue ?? 0, r.currency), r.nights ?? 0, r.check_in, r.check_out, monthStart, monthEnd)
    a.gross += gross
    a.nights += overlapNightsForMonth(r.check_in, r.check_out, monthStart, monthEnd)
    if (isDirect(r.channel)) a.direct += gross * DIRECT_RATE
    if (r.check_out >= monthStart && r.check_out <= monthEnd) a.checkouts++
  }
  // Commission + cleaning per prop
  for (const pid of Object.keys(perProp)) {
    const p = propMap[pid]; const a = perProp[pid]
    a.commission = a.gross * ((p?.nok_commission_rate ?? 0) / 100)
    if (p?.cleaning_fee && a.checkouts > 0) {
      const raw = Number(p.cleaning_fee)
      a.cleaning = p.cleaning_fee_currency === 'COP' ? await copToUSD(raw * a.checkouts) : raw * a.checkouts
    }
  }
  for (const u of monthUtilRes.data ?? []) {
    const a = perProp[u.property_id]; if (!a) continue
    const amt = Number(u.amount) || 0
    a.utilities += (u.currency || 'COP').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }
  for (const m of monthMaintRes.data ?? []) {
    const a = perProp[m.property_id]; if (!a) continue
    const amt = Number(m.amount) || 0
    a.maintenance += (m.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }
  for (const pid of Object.keys(perProp)) {
    const a = perProp[pid]
    a.net = a.gross - a.commission - a.cleaning - a.direct - a.utilities - a.maintenance
  }

  // Group totals (month)
  const totals = Object.values(perProp).reduce((t, a) => ({
    gross: t.gross + a.gross,
    nights: t.nights + a.nights,
    commission: t.commission + a.commission,
    cleaning: t.cleaning + a.cleaning,
    direct: t.direct + a.direct,
    utilities: t.utilities + a.utilities,
    maintenance: t.maintenance + a.maintenance,
    net: t.net + a.net,
  }), { gross:0,nights:0,commission:0,cleaning:0,direct:0,utilities:0,maintenance:0,net:0 })

  // Group-level costs for selected month
  let groupMonthCost = 0
  let groupYtdCost = 0
  for (const c of groupCosts ?? []) {
    const amt = Number(c.amount) || 0
    const usd = (c.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
    if (c.date >= monthStart && c.date <= monthEnd) groupMonthCost += usd
    if (c.date >= yearStart) groupYtdCost += usd
  }
  totals.net -= groupMonthCost

  // YTD aggregates (lightweight: just totals)
  let ytdGross = 0, ytdComm = 0, ytdCleaning = 0, ytdDirect = 0, ytdUtil = 0, ytdMaint = 0
  const ytdCheckoutsByProp: Record<string, number> = {}
  for (const r of ytdResRes.data ?? []) {
    const usd = toUSD(r.owner_revenue ?? 0, r.currency)
    ytdGross += usd
    if (isDirect(r.channel)) ytdDirect += usd * DIRECT_RATE
    ytdCheckoutsByProp[r.property_id] = (ytdCheckoutsByProp[r.property_id] ?? 0) + 1
    const p = propMap[r.property_id]
    if (p) ytdComm += usd * ((p.nok_commission_rate ?? 0) / 100)
  }
  for (const pid of Object.keys(ytdCheckoutsByProp)) {
    const p = propMap[pid]; if (!p?.cleaning_fee) continue
    const raw = Number(p.cleaning_fee) * ytdCheckoutsByProp[pid]
    ytdCleaning += p.cleaning_fee_currency === 'COP' ? await copToUSD(raw) : raw
  }
  for (const u of ytdUtilRes.data ?? []) {
    const amt = Number(u.amount) || 0
    ytdUtil += (u.currency || 'COP').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }
  for (const m of ytdMaintRes.data ?? []) {
    const amt = Number(m.amount) || 0
    ytdMaint += (m.currency || 'USD').toUpperCase() === 'USD' ? amt : await copToUSD(amt)
  }
  const ytdNet = ytdGross - ytdComm - ytdCleaning - ytdDirect - ytdUtil - ytdMaint - groupYtdCost

  const occupancy = daysInMonth > 0 && (props?.length ?? 0) > 0
    ? Math.round((totals.nights / (daysInMonth * (props?.length ?? 1))) * 100)
    : 0

  return (
    <div style={{ backgroundColor: '#F0EFED' }} className="min-h-screen">
      <section className="relative px-6 lg:px-10 py-12 max-w-6xl mx-auto">
        <h1 className="font-serif text-4xl text-[#1A1A1A] mb-2">Grupo: {group.name}</h1>
        <p className="text-sm text-[#1A1A1A]/50 mb-8">
          Vista consolidada de {props?.length ?? 0} propiedades {group.description ? `· ${group.description}` : ''}
        </p>

        <div className="grid grid-cols-4 gap-3 mb-10 max-w-3xl">
          <Kpi value={fmt(totals.gross)} label="Ingresos del mes" />
          <Kpi value={`${occupancy}%`} label="Ocupación prom." />
          <Kpi value={String(totals.nights)} label="Noches reservadas" />
          <Kpi value={fmt(totals.net)} label="Neto propietario" highlight />
        </div>

        <div className="mb-6">
          <MonthPills year={displayYear} selected={selectedMonthKey} />
        </div>

        {/* Financial summary */}
        <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
          <h2 className="font-serif text-2xl text-[#1A1A1A] mb-4">Resumen consolidado — {monthLabel(selectedMonthKey)}</h2>
          <FinRow label="Ingresos después de comisiones de canal" value={fmt(totals.gross)} />
          <FinRow label="Comisión NOK" value={`− ${fmt(totals.commission)}`} deduct />
          {totals.cleaning > 0 && <FinRow label="Limpieza" value={`− ${fmt(totals.cleaning)}`} deduct />}
          {totals.direct > 0 && <FinRow label="Comisión Reserva Directa (10%)" value={`− ${fmt(totals.direct)}`} deduct />}
          {totals.utilities > 0 && <FinRow label="Utilities (servicios)" value={`− ${fmt(totals.utilities)}`} deduct />}
          {totals.maintenance > 0 && <FinRow label="Mantenimiento" value={`− ${fmt(totals.maintenance)}`} deduct />}
          {groupMonthCost > 0 && <FinRow label="Costos del grupo" value={`− ${fmt(groupMonthCost)}`} deduct />}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#1A1A1A]/10">
            <span className="text-[#1A1A1A] font-medium">Ingreso neto propietario</span>
            <span className="text-[#0E6845] text-xl font-semibold">{fmt(totals.net)}</span>
          </div>
        </div>

        {/* Per-property breakdown */}
        <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
          <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">Desglose por propiedad</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#1A1A1A]/40 text-xs uppercase tracking-wider">
                <th className="py-2">Propiedad</th>
                <th className="py-2 text-right">Ingresos</th>
                <th className="py-2 text-right">Noches</th>
                <th className="py-2 text-right">Costos</th>
                <th className="py-2 text-right">Neto</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(perProp).map(([pid, a]) => {
                const costs = a.commission + a.cleaning + a.direct + a.utilities + a.maintenance
                return (
                  <tr key={pid} className="border-t border-[#1A1A1A]/5">
                    <td className="py-2 text-[#1A1A1A]">
                      <Link href={`/dashboard/${pid}/overview`} className="hover:text-[#833B0E]">{a.name}</Link>
                    </td>
                    <td className="py-2 text-right text-[#1A1A1A]/80">{fmt(a.gross)}</td>
                    <td className="py-2 text-right text-[#1A1A1A]/60">{a.nights}</td>
                    <td className="py-2 text-right text-[#F20022]/80">− {fmt(costs)}</td>
                    <td className="py-2 text-right text-[#0E6845]">{fmt(a.net)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* YTD */}
        <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
          <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">Acumulado {displayYear} (YTD)</h2>
          <FinRow label="Ingresos después de comisiones de canal" value={fmt(ytdGross)} />
          <FinRow label="Comisión NOK" value={`− ${fmt(ytdComm)}`} deduct />
          {ytdCleaning > 0 && <FinRow label="Limpieza" value={`− ${fmt(ytdCleaning)}`} deduct />}
          {ytdDirect > 0 && <FinRow label="Comisión Reserva Directa" value={`− ${fmt(ytdDirect)}`} deduct />}
          {ytdUtil > 0 && <FinRow label="Utilities" value={`− ${fmt(ytdUtil)}`} deduct />}
          {ytdMaint > 0 && <FinRow label="Mantenimiento" value={`− ${fmt(ytdMaint)}`} deduct />}
          {groupYtdCost > 0 && <FinRow label="Costos del grupo" value={`− ${fmt(groupYtdCost)}`} deduct />}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#1A1A1A]/10">
            <span className="text-[#1A1A1A] font-medium">Neto YTD</span>
            <span className="text-[#0E6845] text-xl font-semibold">{fmt(ytdNet)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function Kpi({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-3" style={{ backgroundColor: '#FFFFFF', border: `1px solid ${highlight ? 'rgba(14,104,69,0.4)' : 'rgba(26,26,26,0.08)'}` }}>
      <div className={`text-xl font-semibold ${highlight ? 'text-[#0E6845]' : 'text-[#1A1A1A]'}`}>{value}</div>
      <div className="text-[11px] text-[#1A1A1A]/40 mt-0.5">{label}</div>
    </div>
  )
}

function FinRow({ label, value, deduct }: { label: string; value: string; deduct?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[#1A1A1A]/70">{label}</span>
      <span className={`text-sm ${deduct ? 'text-[#F20022]/80' : 'text-[#1A1A1A]'}`}>{value}</span>
    </div>
  )
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })
}
