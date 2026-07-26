import { notFound } from 'next/navigation'
import { loadOwnerProperty } from '@/lib/admin'
import { getMonthlyStatement, monthLabel } from '@/lib/monthly-statement'
import { CATEGORY_LABELS } from '@/lib/owner-costs'
import MonthPills from '@/components/dashboard/MonthPills'
import StatementPdfButton from '@/components/calculos/StatementPdfButton'
import { AddExpenseForm, RemoveExpenseButton } from '@/components/calculos/ExpenseForm'

interface Props {
  params: Promise<{ propertyId: string }>
  searchParams: Promise<{ month?: string }>
}

const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  ...CATEGORY_LABELS,
  admin: 'Administración',
  bank: 'Banco / crédito',
}

function fmt(amount: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

const CHANNEL_META: { key: string; label: string; color: string }[] = [
  { key: 'airbnb_url', label: 'Airbnb', color: '#ef4444' },
  { key: 'booking_url', label: 'Booking.com', color: '#0080C6' },
  { key: 'marriot_url', label: 'Marriott', color: '#4D439E' },
  { key: 'nok_booking_engine_url', label: 'NOK.rent', color: '#0E6845' },
]

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

export default async function CalculosPage({ params, searchParams }: Props) {
  const { propertyId } = await params
  const { month: monthParam } = await searchParams

  const { owner, property, sb } = await loadOwnerProperty(propertyId)
  if (!property) notFound()

  const now = new Date()
  const selectedMonthKey = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
    ? monthParam
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const statement = await getMonthlyStatement(sb, property, selectedMonthKey)
  const label = monthLabel(selectedMonthKey)

  // TODOS los gastos guardados del inmueble (no solo los del mes visible) — así el
  // owner siempre los ve y nunca parecen "borrados" al cambiar de mes o re-entrar.
  const { data: allCostsRaw } = await sb
    .from('owner_costs')
    .select('id, label, category, amount, currency, frequency, start_date, end_date')
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .then((r: any) => r, () => ({ data: [] }))
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const mLabel = (iso: string) => { const [y, m] = iso.slice(0, 7).split('-'); return `${MES_CORTO[+m - 1]} ${y}` }
  const [selY, selM] = selectedMonthKey.split('-').map(Number)
  const selStart = new Date(selY, selM - 1, 1)
  const selEnd = new Date(selY, selM, 0)
  const savedExpenses = (allCostsRaw ?? []).map((c: any) => {
    const start = new Date(c.start_date + 'T00:00:00')
    const end = c.end_date ? new Date(c.end_date + 'T00:00:00') : null
    const appliesThisMonth = c.frequency === 'one_time'
      ? (start >= selStart && start <= selEnd)
      : (start <= selEnd && (!end || end >= selStart))
    const scope = c.frequency === 'one_time'
      ? `solo ${mLabel(c.start_date)}`
      : end
        ? `cada mes · ${mLabel(c.start_date)} → ${mLabel(c.end_date)}`
        : `cada mes desde ${mLabel(c.start_date)}`
    return { ...c, appliesThisMonth, scope }
  })

  const publishedChannels = CHANNEL_META
    .map(c => ({ ...c, url: (property as any)[c.key] as string | null }))
    .filter(c => c.url && c.url.trim())

  // Barras del desglose de gastos finales (deducciones NOK + gastos propios)
  const breakdown: { label: string; amount: number; color: string }[] = [
    { label: 'Comisión NOK', amount: statement.nokCommission, color: '#833B0E' },
    { label: 'Limpiezas', amount: statement.cleaning, color: '#94B8CF' },
    { label: 'Reserva directa', amount: statement.directCommission, color: '#B9B5DC' },
    { label: 'Servicios', amount: statement.utilities, color: '#0080C6' },
    { label: 'Mantenimiento', amount: statement.maintenance, color: '#D6A700' },
    { label: 'Tus gastos', amount: statement.ownerExpensesTotal, color: '#F20022' },
  ].filter(b => b.amount > 0)
  const breakdownMax = Math.max(1, ...breakdown.map(b => b.amount))
  const totalOutflows = breakdown.reduce((s, b) => s + b.amount, 0)

  const deductionRows: { label: string; amount: number }[] = [
    { label: `Comisión NOK (${Math.round(statement.commissionRate * 100)}%)`, amount: statement.nokCommission },
    { label: `Limpiezas (${statement.checkouts} check-outs)`, amount: statement.cleaning },
    { label: 'Comisión reserva directa (10%)', amount: statement.directCommission },
    { label: 'Servicios públicos', amount: statement.utilities },
    { label: 'Mantenimiento', amount: statement.maintenance },
  ].filter(r => r.amount > 0)

  return (
    <div className="px-6 lg:px-16 py-10" style={{ backgroundColor: '#F0EFED', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
            {property.name}
          </p>
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">Cálculos</h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(26,26,26,0.45)' }}>
            Tu resultado real del mes: el reporte NOK más los gastos que tú registras.
          </p>
        </div>
        <StatementPdfButton statement={statement} ownerName={(owner as any).name ?? ''} monthLabel={label} />
      </div>

      <div className="mb-8">
        <MonthPills year={Number(selectedMonthKey.slice(0, 4))} selected={selectedMonthKey} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Col 1-2: statement ── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Reporte NOK */}
          <div className="rounded-2xl p-6 nok-card">
            <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#833B0E' }}>Reporte NOK · {label}</p>
            <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
              <span className="text-sm text-[#1A1A1A]">Ingresos brutos del mes</span>
              <span className="text-sm font-semibold text-[#1A1A1A]">{fmt(statement.gross)}</span>
            </div>
            {deductionRows.map(r => (
              <div key={r.label} className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
                <span className="text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>{r.label}</span>
                <span className="text-sm font-medium" style={{ color: '#F20022' }}>−{fmt(r.amount)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between mt-4 px-4 py-3 rounded-xl" style={{ backgroundColor: 'rgba(14,104,69,0.08)' }}>
              <span className="text-sm font-semibold text-[#1A1A1A]">Ingreso neto propietario (NOK)</span>
              <span className="text-lg font-semibold" style={{ color: '#0E6845' }}>{fmt(statement.nokNet)}</span>
            </div>
            <p className="text-[11px] mt-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
              {statement.occupancyPct}% de ocupación · {statement.nights} noches · ADR {fmt(statement.adr)} · {statement.currencyNote}
            </p>
          </div>

          {/* Tus gastos */}
          <div className="rounded-2xl p-6 nok-card">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest" style={{ color: '#833B0E' }}>Tus gastos adicionales</p>
              <span className="text-sm font-semibold" style={{ color: '#F20022' }}>−{fmt(statement.ownerExpensesTotal)}</span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Administración, banco, seguro… lo que pagas por fuera de NOK. Quedan guardados permanentemente para los meses que designes. Solo tú los ves; no afectan tu liquidación NOK.
            </p>

            {savedExpenses.length > 0 && (
              <div className="mt-4">
                {savedExpenses.map((e: typeof savedExpenses[number]) => (
                  <div key={e.id} className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)', opacity: e.appliesThisMonth ? 1 : 0.5 }}>
                    <div className="min-w-0">
                      <p className="text-sm text-[#1A1A1A] truncate">{e.label}</p>
                      <p className="text-[11px]" style={{ color: 'rgba(26,26,26,0.4)' }}>
                        {EXPENSE_CATEGORY_LABELS[e.category ?? 'other'] ?? 'Otro'} · {e.scope}
                        {e.currency !== 'USD' ? ` · ${Number(e.amount).toLocaleString('en-US')} ${e.currency}` : ''}
                        {!e.appliesThisMonth ? ` · no aplica a ${label.toLowerCase()}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-medium" style={{ color: e.appliesThisMonth ? '#F20022' : 'rgba(26,26,26,0.3)' }}>
                        {e.appliesThisMonth ? '−' : ''}{e.currency === 'USD' ? fmt(Number(e.amount)) : `${Number(e.amount).toLocaleString('en-US')} ${e.currency}`}
                      </span>
                      <RemoveExpenseButton propertyId={propertyId} costId={e.id} />
                    </div>
                  </div>
                ))}
                <p className="text-[11px] mt-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  Los gastos en gris no aplican al mes que estás viendo, pero siguen guardados para sus meses.
                </p>
              </div>
            )}

            <AddExpenseForm propertyId={propertyId} monthKey={selectedMonthKey} />
          </div>

          {/* Resultado final */}
          <div className="rounded-2xl p-6 flex flex-wrap items-center justify-between gap-4" style={{ backgroundColor: '#1A1A1A' }}>
            <div>
              <p className="text-xs uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Resultado final · {label}
              </p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.35)' }}>
                Ingreso neto NOK − tus gastos adicionales
              </p>
            </div>
            <p className="font-serif text-4xl font-light" style={{ color: statement.finalNet < 0 ? '#FF6B81' : '#FFFFFF' }}>
              {fmt(statement.finalNet)}
            </p>
          </div>
        </div>

        {/* ── Col 3: breakdown + links ── */}
        <div className="space-y-6">
          {/* Desglose de gastos */}
          <div className="rounded-2xl p-6 nok-card">
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#833B0E' }}>Desglose de gastos del mes</p>
            <p className="text-2xl font-light font-serif text-[#1A1A1A] mb-4">{fmt(totalOutflows)}</p>
            {breakdown.length === 0 ? (
              <p className="text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>Sin gastos este mes.</p>
            ) : (
              <div className="space-y-3">
                {breakdown.map(b => (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: 'rgba(26,26,26,0.55)' }}>{b.label}</span>
                      <span className="text-xs font-medium text-[#1A1A1A]">{fmt(b.amount)}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(26,26,26,0.05)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(4, (b.amount / breakdownMax) * 100)}%`, backgroundColor: b.color }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Links de publicación */}
          <div className="rounded-2xl p-6 nok-card">
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: '#833B0E' }}>Dónde está publicado</p>
            <p className="text-xs mb-4" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Los anuncios activos de {property.name}.
            </p>
            {publishedChannels.length === 0 ? (
              <p className="text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>
                El equipo NOK está cargando los links de tus anuncios. Escríbenos desde la pestaña Equipo NOK si los necesitas ya.
              </p>
            ) : (
              <div className="space-y-2">
                {publishedChannels.map(c => (
                  <a
                    key={c.key}
                    href={c.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200"
                    style={{ backgroundColor: 'rgba(26,26,26,0.03)', border: '1px solid rgba(26,26,26,0.08)', color: '#1A1A1A' }}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      {c.label}
                    </span>
                    <span style={{ color: 'rgba(26,26,26,0.35)' }}><ExternalIcon /></span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
