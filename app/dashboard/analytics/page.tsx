'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'

interface PropertyLite { id: string; name: string }
interface MonthRow {
  month: string; revenue: number; nights: number; checkouts: number;
  commission: number; cleaning: number; direct: number; utilities: number; maintenance: number;
  net: number; adr: number; occupancy: number
}
interface PropertySeries { id: string; name: string; months: MonthRow[] }

const COLORS = ['#833B0E', '#0E6845', '#0080C6', '#D6A700', '#4D439E', '#E07A5F', '#8E44AD', '#16A085']

function fmtUSD(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
}
function shortMonth(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('es-CO', { month: 'short', year: '2-digit' })
}

export default function AnalyticsPage() {
  const [properties, setProperties] = useState<PropertyLite[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [series, setSeries] = useState<PropertySeries[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'compare' | 'consolidated'>('compare')
  const [groups, setGroups] = useState<{ id: string; name: string; property_ids: string[] }[]>([])

  // Load property list and groups
  useEffect(() => {
    ;(async () => {
      const [p, g] = await Promise.all([
        fetch('/api/analytics/properties').then((r) => r.json()),
        fetch('/api/analytics/groups').then((r) => r.json()),
      ])
      setProperties(p.properties ?? [])
      setGroups(g.groups ?? [])
      if (p.properties?.length) setSelected([p.properties[0].id])
    })()
  }, [])

  async function saveAsGroup() {
    const name = prompt('Nombre del grupo:')
    if (!name) return
    const res = await fetch('/api/analytics/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, property_ids: selected }),
    })
    if (!res.ok) { alert('Error al guardar'); return }
    const g = await fetch('/api/analytics/groups').then((r) => r.json())
    setGroups(g.groups ?? [])
  }

  async function deleteGroup(id: string) {
    if (!confirm('¿Eliminar grupo?')) return
    await fetch(`/api/analytics/groups?id=${id}`, { method: 'DELETE' })
    const g = await fetch('/api/analytics/groups').then((r) => r.json())
    setGroups(g.groups ?? [])
  }

  // Fetch timeseries whenever selection changes
  useEffect(() => {
    if (selected.length === 0) { setSeries([]); return }
    setLoading(true)
    fetch(`/api/analytics/timeseries?propertyIds=${selected.join(',')}`)
      .then((r) => r.json())
      .then((j) => setSeries(j.data ?? []))
      .finally(() => setLoading(false))
  }, [selected])

  // Combined chart data — one object per month
  const chartData = useMemo(() => {
    if (series.length === 0) return []
    const months = series[0].months.map((m) => m.month)
    return months.map((mk) => {
      const row: any = { month: shortMonth(mk) }
      if (mode === 'consolidated') {
        let rev = 0, net = 0, nights = 0, occSum = 0, n = 0
        for (const p of series) {
          const r = p.months.find((x) => x.month === mk)!
          rev += r.revenue; net += r.net; nights += r.nights; occSum += r.occupancy; n++
        }
        row['Consolidado_revenue'] = Math.round(rev)
        row['Consolidado_net'] = Math.round(net)
        row['Consolidado_occupancy'] = n > 0 ? Math.round(occSum / n) : 0
        row['Consolidado_adr'] = nights > 0 ? Math.round(rev / nights) : 0
      } else {
        for (const p of series) {
          const r = p.months.find((x) => x.month === mk)!
          row[`${p.name}_revenue`] = Math.round(r.revenue)
          row[`${p.name}_net`] = Math.round(r.net)
          row[`${p.name}_occupancy`] = Math.round(r.occupancy)
          row[`${p.name}_adr`] = Math.round(r.adr)
        }
      }
      return row
    })
  }, [series, mode])

  // Consolidated monthly detail rows (for the table)
  const consolidatedRows = useMemo(() => {
    if (series.length === 0) return []
    const months = series[0].months.map((m) => m.month)
    return months.map((mk) => {
      const t = { revenue:0, nights:0, commission:0, cleaning:0, direct:0, utilities:0, maintenance:0, net:0, occSum:0, n:0 }
      for (const p of series) {
        const r = p.months.find((x) => x.month === mk)!
        t.revenue += r.revenue; t.nights += r.nights; t.commission += r.commission
        t.cleaning += r.cleaning; t.direct += r.direct; t.utilities += r.utilities
        t.maintenance += r.maintenance; t.net += r.net; t.occSum += r.occupancy; t.n++
      }
      return {
        month: mk,
        label: shortMonth(mk),
        revenue: t.revenue,
        nights: t.nights,
        adr: t.nights > 0 ? t.revenue / t.nights : 0,
        occupancy: t.n > 0 ? t.occSum / t.n : 0,
        commission: t.commission,
        cleaning: t.cleaning,
        direct: t.direct,
        utilities: t.utilities,
        maintenance: t.maintenance,
        net: t.net,
      }
    })
  }, [series])

  // Stacked cost breakdown (single property OR summed if multiple)
  const costBreakdown = useMemo(() => {
    if (series.length === 0) return []
    const months = series[0].months.map((m) => m.month)
    return months.map((mk) => {
      const row: any = { month: shortMonth(mk), commission: 0, cleaning: 0, direct: 0, utilities: 0, maintenance: 0 }
      for (const p of series) {
        const r = p.months.find((x) => x.month === mk)!
        row.commission += r.commission
        row.cleaning += r.cleaning
        row.direct += r.direct
        row.utilities += r.utilities
        row.maintenance += r.maintenance
      }
      for (const k of ['commission','cleaning','direct','utilities','maintenance']) row[k] = Math.round(row[k])
      return row
    })
  }, [series])

  // YTD cost donut totals (sum across selection)
  const costTotals = useMemo(() => {
    const t = { commission: 0, cleaning: 0, direct: 0, utilities: 0, maintenance: 0 }
    for (const p of series) for (const m of p.months) {
      t.commission += m.commission; t.cleaning += m.cleaning; t.direct += m.direct; t.utilities += m.utilities; t.maintenance += m.maintenance
    }
    return [
      { name: 'Comisión NOK', value: Math.round(t.commission) },
      { name: 'Limpieza', value: Math.round(t.cleaning) },
      { name: 'Reserva Directa', value: Math.round(t.direct) },
      { name: 'Utilities', value: Math.round(t.utilities) },
      { name: 'Mantenimiento', value: Math.round(t.maintenance) },
    ].filter((x) => x.value > 0)
  }, [series])

  const toggleProp = (id: string) => {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])
  }

  return (
    <div className="min-h-screen px-6 lg:px-10 py-10 max-w-7xl mx-auto" style={{ backgroundColor: '#F0EFED' }}>
      <h1 className="font-serif text-4xl text-[#1A1A1A] mb-2">Analíticas</h1>
      <p className="text-sm text-[#1A1A1A]/50 mb-8">Últimos 12 meses · ingresos, ocupación, ADR y desglose de costos.</p>

      {/* Mode toggle */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setMode('compare')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            backgroundColor: mode === 'compare' ? 'rgba(131, 59, 14,0.25)' : 'rgba(26,26,26,0.04)',
            border: `1px solid ${mode === 'compare' ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
            color: mode === 'compare' ? '#1A1A1A' : 'rgba(26,26,26,0.55)',
          }}
        >
          Comparar
        </button>
        <button
          onClick={() => setMode('consolidated')}
          className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
          style={{
            backgroundColor: mode === 'consolidated' ? 'rgba(131, 59, 14,0.25)' : 'rgba(26,26,26,0.04)',
            border: `1px solid ${mode === 'consolidated' ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
            color: mode === 'consolidated' ? '#1A1A1A' : 'rgba(26,26,26,0.55)',
          }}
        >
          Consolidado
        </button>
      </div>

      {/* Saved groups quick-load */}
      {groups.length > 0 && (
        <div className="mb-4 p-4 rounded-xl" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
          <p className="text-xs text-[#1A1A1A]/50 uppercase tracking-wider mb-2">Mis grupos guardados</p>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <div key={g.id} className="flex items-center gap-1">
                <button
                  onClick={() => { setSelected(g.property_ids); setMode('consolidated') }}
                  className="px-3 py-1.5 rounded-lg text-xs transition-all"
                  style={{
                    backgroundColor: 'rgba(214,167,0,0.15)',
                    border: '1px solid rgba(214,167,0,0.35)',
                    color: '#D6A700',
                  }}
                >
                  ▦ {g.name} <span className="opacity-50">· {g.property_ids.length}</span>
                </button>
                <button
                  onClick={() => deleteGroup(g.id)}
                  className="text-[#F20022]/60 text-xs px-1 hover:text-[#F20022]"
                  title="Eliminar grupo"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Property multi-select */}
      <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-[#1A1A1A]/50 uppercase tracking-wider">Propiedades seleccionadas ({selected.length})</p>
          {selected.length > 1 && (
            <button
              onClick={saveAsGroup}
              className="px-3 py-1 rounded-lg text-xs transition-all"
              style={{
                backgroundColor: 'rgba(14,104,69,0.15)',
                border: '1px solid rgba(14,104,69,0.4)',
                color: '#0E6845',
              }}
            >
              + Guardar como grupo
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {properties.map((p) => {
            const active = selected.includes(p.id)
            return (
              <button
                key={p.id}
                onClick={() => toggleProp(p.id)}
                className="px-3 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  backgroundColor: active ? 'rgba(131, 59, 14,0.25)' : 'rgba(26,26,26,0.04)',
                  border: `1px solid ${active ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
                  color: active ? '#1A1A1A' : 'rgba(26,26,26,0.55)',
                }}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </div>

      {loading && <p className="text-[#1A1A1A]/50 text-sm">Cargando…</p>}

      {series.length > 0 && (
        <>
          {/* Revenue (line) */}
          <ChartCard title="Ingresos por mes (USD)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.06)" />
                <XAxis dataKey="month" stroke="rgba(26,26,26,0.4)" fontSize={11} />
                <YAxis stroke="rgba(26,26,26,0.4)" fontSize={11} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => fmtUSD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {mode === 'consolidated'
                  ? <Line type="monotone" dataKey="Consolidado_revenue" name="Consolidado" stroke="#833B0E" strokeWidth={2.5} dot={false} />
                  : series.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={`${p.name}_revenue`} name={p.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Net revenue (line) */}
          <ChartCard title="Ingreso neto propietario (USD)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.06)" />
                <XAxis dataKey="month" stroke="rgba(26,26,26,0.4)" fontSize={11} />
                <YAxis stroke="rgba(26,26,26,0.4)" fontSize={11} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => fmtUSD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {mode === 'consolidated'
                  ? <Line type="monotone" dataKey="Consolidado_net" name="Consolidado" stroke="#0E6845" strokeWidth={2.5} dot={false} />
                  : series.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={`${p.name}_net`} name={p.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Occupancy */}
          <ChartCard title="Ocupación (%)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.06)" />
                <XAxis dataKey="month" stroke="rgba(26,26,26,0.4)" fontSize={11} />
                <YAxis stroke="rgba(26,26,26,0.4)" fontSize={11} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {mode === 'consolidated'
                  ? <Line type="monotone" dataKey="Consolidado_occupancy" name="Consolidado" stroke="#D6A700" strokeWidth={2.5} dot={false} />
                  : series.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={`${p.name}_occupancy`} name={p.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* ADR */}
          <ChartCard title="ADR (Tarifa promedio diaria, USD)">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.06)" />
                <XAxis dataKey="month" stroke="rgba(26,26,26,0.4)" fontSize={11} />
                <YAxis stroke="rgba(26,26,26,0.4)" fontSize={11} tickFormatter={(v) => `$${v}`} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => fmtUSD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {mode === 'consolidated'
                  ? <Line type="monotone" dataKey="Consolidado_adr" name="Consolidado" stroke="#0080C6" strokeWidth={2.5} dot={false} />
                  : series.map((p, i) => (
                    <Line key={p.id} type="monotone" dataKey={`${p.name}_adr`} name={p.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Cost stacked bar */}
          <ChartCard title="Costos por mes (desglose)">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={costBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,26,26,0.06)" />
                <XAxis dataKey="month" stroke="rgba(26,26,26,0.4)" fontSize={11} />
                <YAxis stroke="rgba(26,26,26,0.4)" fontSize={11} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => fmtUSD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="commission" stackId="a" name="Comisión NOK" fill="#B9B5DC" />
                <Bar dataKey="cleaning" stackId="a" name="Limpieza" fill="#D6A700" />
                <Bar dataKey="direct" stackId="a" name="Reserva Directa" fill="#0E6845" />
                <Bar dataKey="utilities" stackId="a" name="Utilities" fill="#0080C6" />
                <Bar dataKey="maintenance" stackId="a" name="Mantenimiento" fill="#F20022" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Consolidated monthly detail table */}
          {mode === 'consolidated' && (
            <ChartCard title="Reporte consolidado mes a mes">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[#1A1A1A]/40 uppercase tracking-wider">
                      <th className="py-2 pr-3">Mes</th>
                      <th className="py-2 px-2 text-right">Ingresos</th>
                      <th className="py-2 px-2 text-right">Noches</th>
                      <th className="py-2 px-2 text-right">ADR</th>
                      <th className="py-2 px-2 text-right">Ocup.</th>
                      <th className="py-2 px-2 text-right">Comis. NOK</th>
                      <th className="py-2 px-2 text-right">Limpieza</th>
                      <th className="py-2 px-2 text-right">Res. Directa</th>
                      <th className="py-2 px-2 text-right">Utilities</th>
                      <th className="py-2 px-2 text-right">Mant.</th>
                      <th className="py-2 pl-2 text-right">Neto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidatedRows.map((r) => (
                      <tr key={r.month} className="border-t border-[#1A1A1A]/5 text-[#1A1A1A]/80">
                        <td className="py-2 pr-3 text-[#1A1A1A]">{r.label}</td>
                        <td className="py-2 px-2 text-right">{fmtUSD(r.revenue)}</td>
                        <td className="py-2 px-2 text-right">{r.nights}</td>
                        <td className="py-2 px-2 text-right">{fmtUSD(r.adr)}</td>
                        <td className="py-2 px-2 text-right">{Math.round(r.occupancy)}%</td>
                        <td className="py-2 px-2 text-right text-[#F20022]/80">− {fmtUSD(r.commission)}</td>
                        <td className="py-2 px-2 text-right text-[#F20022]/80">− {fmtUSD(r.cleaning)}</td>
                        <td className="py-2 px-2 text-right text-[#F20022]/80">− {fmtUSD(r.direct)}</td>
                        <td className="py-2 px-2 text-right text-[#F20022]/80">− {fmtUSD(r.utilities)}</td>
                        <td className="py-2 px-2 text-right text-[#F20022]/80">− {fmtUSD(r.maintenance)}</td>
                        <td className="py-2 pl-2 text-right text-[#0E6845] font-medium">{fmtUSD(r.net)}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    {(() => {
                      const t = consolidatedRows.reduce((a, r) => ({
                        revenue: a.revenue + r.revenue, nights: a.nights + r.nights,
                        commission: a.commission + r.commission, cleaning: a.cleaning + r.cleaning,
                        direct: a.direct + r.direct, utilities: a.utilities + r.utilities,
                        maintenance: a.maintenance + r.maintenance, net: a.net + r.net,
                      }), { revenue:0,nights:0,commission:0,cleaning:0,direct:0,utilities:0,maintenance:0,net:0 })
                      const adr = t.nights > 0 ? t.revenue / t.nights : 0
                      return (
                        <tr className="border-t-2 border-[#1A1A1A]/20 text-[#1A1A1A] font-medium">
                          <td className="py-2 pr-3">Total 12m</td>
                          <td className="py-2 px-2 text-right">{fmtUSD(t.revenue)}</td>
                          <td className="py-2 px-2 text-right">{t.nights}</td>
                          <td className="py-2 px-2 text-right">{fmtUSD(adr)}</td>
                          <td className="py-2 px-2 text-right">—</td>
                          <td className="py-2 px-2 text-right">− {fmtUSD(t.commission)}</td>
                          <td className="py-2 px-2 text-right">− {fmtUSD(t.cleaning)}</td>
                          <td className="py-2 px-2 text-right">− {fmtUSD(t.direct)}</td>
                          <td className="py-2 px-2 text-right">− {fmtUSD(t.utilities)}</td>
                          <td className="py-2 px-2 text-right">− {fmtUSD(t.maintenance)}</td>
                          <td className="py-2 pl-2 text-right text-[#0E6845]">{fmtUSD(t.net)}</td>
                        </tr>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          )}

          {/* Cost distribution donut (12m total) */}
          <ChartCard title="Distribución de costos (últimos 12 meses)">
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={costTotals} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                  {costTotals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.1)' }} formatter={(v: any) => fmtUSD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 p-5 rounded-xl" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
      <h3 className="text-sm text-[#1A1A1A]/80 mb-3 font-medium">{title}</h3>
      {children}
    </div>
  )
}
