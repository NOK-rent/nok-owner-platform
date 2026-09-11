import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { loadMonthlyFx } from '@/lib/trm'
import { isAdminEmail } from '@/lib/admin'

// Returns 12-month timeseries per property: revenue, nights, adr, occupancy, commission, cleaning, direct, utilities, maintenance, net.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const idsParam = searchParams.get('propertyIds') || ''
  const propertyIds = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
  if (propertyIds.length === 0) return NextResponse.json({ data: [] })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, email').eq('supabase_user_id', user.id).single()
  if (!owner) return NextResponse.json({ error: 'no owner' }, { status: 403 })
  const isAdmin = isAdminEmail(owner.email)

  // Access control — non-admin users can only query their own properties
  let allowedIds = propertyIds
  if (!isAdmin) {
    const { data: myProps } = await sb.from('properties').select('id').eq('owner_id', owner.id).in('id', propertyIds)
    allowedIds = (myProps ?? []).map((p: any) => p.id)
  }
  if (allowedIds.length === 0) return NextResponse.json({ data: [] })

  const { data: props } = await sb
    .from('properties')
    .select('id, name, nok_commission_rate, cleaning_fee, cleaning_fee_currency')
    .in('id', allowedIds)

  // Build last-12-months range
  const now = new Date()
  const months: { key: string; start: string; end: string; days: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const y = d.getFullYear(), m = d.getMonth() + 1
    const last = new Date(y, m, 0).getDate()
    months.push({
      key: `${y}-${String(m).padStart(2,'0')}`,
      start: `${y}-${String(m).padStart(2,'0')}-01`,
      end: `${y}-${String(m).padStart(2,'0')}-${String(last).padStart(2,'0')}`,
      days: last,
    })
  }
  const rangeStart = months[0].start
  const rangeEnd = months[11].end
  const monthKeys = months.map((m) => m.key)

  // Fetch in parallel
  const [{ data: reservations }, { data: utilities }, { data: maints }] = await Promise.all([
    sb.from('reservations')
      .select('property_id, owner_revenue, nights, currency, check_in, check_out, channel')
      .in('property_id', allowedIds)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', rangeEnd).gte('check_out', rangeStart),
    sb.from('utility_costs')
      .select('property_id, amount, currency, month')
      .in('property_id', allowedIds).in('month', monthKeys),
    sb.from('maintenance_costs')
      .select('property_id, amount, currency, date')
      .in('property_id', allowedIds).gte('date', rangeStart).lte('date', rangeEnd),
  ])

  const isDirect = (ch: string | null | undefined) => {
    const c = (ch ?? '').toLowerCase()
    return c.includes('direct') || c === 'owner' || c === 'manual' || c.includes('website')
  }
  const DIRECT_RATE = 0.10
  // TRM por mes reportado (promedio mensual) — cada mes de la serie a su tasa
  const fx = await loadMonthlyFx(monthKeys)

  function overlapNights(ci: string, co: string, ms: string, me: string) {
    const a = new Date(ci+'T00:00:00'), b = new Date(co+'T00:00:00')
    const s = new Date(ms+'T00:00:00'), e = new Date(me+'T00:00:00'); e.setDate(e.getDate()+1)
    const os = a > s ? a : s, oe = b < e ? b : e
    return Math.max(0, Math.round((oe.getTime()-os.getTime())/(1000*60*60*24)))
  }
  function prorate(rev: number, nights: number, ci: string, co: string, ms: string, me: string) {
    if (nights <= 0 || rev <= 0) return 0
    const on = overlapNights(ci, co, ms, me)
    if (on >= nights) return rev
    return (rev / nights) * on
  }

  // Initialize structure: per property → per month
  type Row = { revenue: number; nights: number; checkouts: number; commission: number; cleaning: number; direct: number; utilities: number; maintenance: number; net: number; adr: number; occupancy: number }
  const series: Record<string, { name: string; months: Record<string, Row> }> = {}
  for (const p of props ?? []) {
    series[p.id] = { name: p.name, months: {} }
    for (const m of months) {
      series[p.id].months[m.key] = { revenue:0,nights:0,checkouts:0,commission:0,cleaning:0,direct:0,utilities:0,maintenance:0,net:0,adr:0,occupancy:0 }
    }
  }

  // Aggregate reservations
  for (const r of reservations ?? []) {
    const pid = r.property_id
    if (!series[pid]) continue
    // For each month, compute prorated piece
    for (const m of months) {
      if (r.check_in > m.end || r.check_out <= m.start) continue
      const rev = fx.toUSD(r.owner_revenue ?? 0, r.currency, m.key)
      const gross = prorate(rev, r.nights ?? 0, r.check_in, r.check_out, m.start, m.end)
      const row = series[pid].months[m.key]
      row.revenue += gross
      row.nights += overlapNights(r.check_in, r.check_out, m.start, m.end)
      if (isDirect(r.channel)) row.direct += gross * DIRECT_RATE
      if (r.check_out >= m.start && r.check_out <= m.end) row.checkouts += 1
    }
  }

  // Apply commission + cleaning per property (requires rates from propMap)
  const propMap: Record<string, any> = Object.fromEntries((props ?? []).map((p: any) => [p.id, p]))
  for (const pid of Object.keys(series)) {
    const p = propMap[pid]
    for (const m of months) {
      const row = series[pid].months[m.key]
      row.commission = row.revenue * ((p?.nok_commission_rate ?? 0) / 100)
      if (p?.cleaning_fee && row.checkouts > 0) {
        const raw = Number(p.cleaning_fee) * row.checkouts
        row.cleaning = fx.toUSD(raw, p.cleaning_fee_currency, m.key)
      }
    }
  }

  // Utilities
  for (const u of utilities ?? []) {
    const row = series[u.property_id]?.months[u.month]
    if (!row) continue
    const amt = Number(u.amount) || 0
    row.utilities += fx.toUSD(amt, u.currency || 'COP', u.month)
  }
  // Maintenance (bucket by month)
  for (const m of maints ?? []) {
    const mk = (m.date || '').slice(0,7)
    const row = series[m.property_id]?.months[mk]
    if (!row) continue
    const amt = Number(m.amount) || 0
    row.maintenance += fx.toUSD(amt, m.currency || 'USD', mk)
  }

  // Finalize: net, adr, occupancy
  for (const pid of Object.keys(series)) {
    for (const m of months) {
      const row = series[pid].months[m.key]
      row.net = row.revenue - row.commission - row.cleaning - row.direct - row.utilities - row.maintenance
      row.adr = row.nights > 0 ? row.revenue / row.nights : 0
      row.occupancy = m.days > 0 ? (row.nights / m.days) * 100 : 0
    }
  }

  const data = Object.entries(series).map(([id, v]) => ({
    id,
    name: v.name,
    months: months.map((m) => ({ month: m.key, ...v.months[m.key] })),
  }))

  return NextResponse.json({ data, months: monthKeys })
}
