import Link from 'next/link'
import { loadOwnerBuilding } from '@/lib/edificio'
import {
  computeBuildingPnl, reportedMonths, currentMonthKey, categoryMeta, COST_CATEGORIES,
  fmtUSD, fmtCOP, monthLabel, type BuildingCostLine,
} from '@/lib/building-pnl'
import { getLocale } from '@/lib/i18n'
import { edificioDict, tpl } from '@/lib/edificio-i18n'
import { signAttachments } from '@/lib/soporte'
import BuildingMonthPills from '@/components/edificio/BuildingMonthPills'

interface Props {
  params: Promise<{ configId: string }>
  searchParams: Promise<{ month?: string; year?: string }>
}

export const revalidate = 0

function fmtOriginal(amount: number, currency: string) {
  return currency === 'COP' ? fmtCOP(amount) : fmtUSD(amount, 2)
}

function FileIcon({ type }: { type?: string }) {
  const pdf = (type ?? '').includes('pdf')
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {pdf ? (
        <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>
      ) : (
        <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>
      )}
    </svg>
  )
}

export default async function EdificioCostosPage({ params, searchParams }: Props) {
  const { configId } = await params
  const { month: monthParam, year: yearParam } = await searchParams
  const { config, properties, propertyIds, sb } = await loadOwnerBuilding(configId)
  const locale = await getLocale()
  const t = edificioDict(locale)

  const nowKey = currentMonthKey()
  const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : Number((monthParam ?? nowKey).slice(0, 4))
  const months = reportedMonths(year, config.start_month)
  const selected = monthParam && months.includes(monthParam)
    ? monthParam
    : (months.includes(nowKey) ? nowKey : (months[months.length - 1] ?? nowKey))
  const minYear = config.start_month ? Number(config.start_month.slice(0, 4)) : undefined
  const [sy, sm] = selected.split('-').map(Number)
  const monthStart = `${selected}-01`
  const monthEnd = `${selected}-${String(new Date(sy, sm, 0).getDate()).padStart(2, '0')}`
  const idList = propertyIds.length ? propertyIds : ['00000000-0000-0000-0000-000000000000']
  const propName = Object.fromEntries(properties.map(p => [p.id, p.name]))

  const [pnl, utilRes, maintRes] = await Promise.all([
    computeBuildingPnl(sb, config, properties, year),
    sb.from('utility_costs').select('id, property_id, utility_type, custom_type, amount, currency, month, reference, receipt_url')
      .in('property_id', idList).eq('month', selected).order('property_id'),
    sb.from('maintenance_costs').select('id, property_id, type, amount, currency, date, description')
      .in('property_id', idList).gte('date', monthStart).lte('date', monthEnd).order('date'),
  ])
  const m = pnl.months.find(x => x.month === selected)
  const lines: BuildingCostLine[] = pnl.costLines[selected] ?? []

  // Firma las facturas (bucket privado) — URLs de 1h
  const signedLines = await Promise.all(lines.map(async l => ({
    ...l,
    attachments: Array.isArray(l.attachments) && l.attachments.length
      ? await signAttachments(sb, l.attachments as any, 3600)
      : [],
  })))

  const grouped = COST_CATEGORIES
    .map(cat => ({ cat, items: signedLines.filter(l => (l.category || 'otros').toLowerCase() === cat.key) }))
    .filter(g => g.items.length > 0)

  const freqLabel = (f: string) => f === 'monthly' ? t.freqMonthly : f === 'per_checkout' ? t.freqPerCheckout : t.freqOneTime
  const utilities: any[] = utilRes.data ?? []
  const maintenance: any[] = maintRes.data ?? []
  const utilMonthUSD = m?.costs.utilities ?? 0
  const maintMonthUSD = m?.costs.maintenance ?? 0

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F0EFED' }}>
      <section className="px-6 lg:px-10 py-10 max-w-6xl mx-auto">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>{config.name}</p>
        <h1 className="font-serif text-4xl font-light text-[#1A1A1A] mb-2">{t.costsTitle}</h1>
        <p className="text-sm mb-8" style={{ color: 'rgba(26,26,26,0.45)' }}>{t.costsSubtitle}</p>

        <div className="mb-8">
          <BuildingMonthPills year={year} selected={selected} months={months} minYear={minYear} locale={locale} />
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <Tile value={fmtUSD(m?.costs.total ?? 0)} label={t.costsMonthTotal} highlight />
          <Tile value={fmtUSD(m?.costs.building ?? 0)} label={t.costsBuilding} />
          <Tile value={fmtUSD(utilMonthUSD)} label={t.utilities} />
          <Tile value={fmtUSD(maintMonthUSD)} label={t.maintenance} />
        </div>

        {/* Building costs with invoices */}
        {grouped.length === 0 ? (
          <div className="rounded-xl p-8 text-center mb-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
            <p className="text-sm text-[#1A1A1A]/70">{t.costsNone}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>{t.costsNoneHint}</p>
          </div>
        ) : (
          <div className="space-y-6 mb-8">
            {grouped.map(({ cat, items }) => {
              const subtotal = items.reduce((s, i) => s + i.amountUSD, 0)
              return (
                <div key={cat.key} className="rounded-xl overflow-hidden" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                  <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                      <h2 className="font-serif text-xl text-[#1A1A1A]">{locale === 'en' ? cat.labelEn : cat.label}</h2>
                      <span className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>· {items.length}</span>
                    </div>
                    <span className="text-sm font-semibold text-[#1A1A1A]">{fmtUSD(subtotal)}</span>
                  </div>
                  <ul>
                    {items.map(l => (
                      <li key={l.id} className="px-6 py-4 flex flex-col md:flex-row md:items-start gap-3" style={{ borderBottom: '1px solid rgba(26,26,26,0.05)' }}>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#1A1A1A]">{l.name}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.45)' }}>
                            {l.vendor ? `${t.vendor}: ${l.vendor} · ` : ''}
                            {freqLabel(l.frequency)}
                            {l.frequency === 'per_checkout' && m ? ` × ${m.checkouts}` : ''}
                            {l.invoice_number ? ` · ${t.invoice} ${l.invoice_number}` : ''}
                            {l.invoice_date ? ` · ${l.invoice_date}` : ''}
                            {l.property_id && propName[l.property_id] ? ` · ${propName[l.property_id]}` : ''}
                          </p>
                          {l.notes && <p className="text-xs mt-1 italic" style={{ color: 'rgba(26,26,26,0.4)' }}>{l.notes}</p>}
                          <div className="flex flex-wrap gap-2 mt-2">
                            {l.attachments.length === 0 ? (
                              <span className="text-[11px] px-2 py-1 rounded-md" style={{ backgroundColor: 'rgba(26,26,26,0.04)', color: 'rgba(26,26,26,0.4)' }}>{t.noInvoice}</span>
                            ) : l.attachments.map((a: any, i: number) => (
                              <a
                                key={a.path ?? i}
                                href={a.url ?? '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md transition-colors"
                                style={{ backgroundColor: 'rgba(131,59,14,0.08)', color: '#833B0E', border: '1px solid rgba(131,59,14,0.2)' }}
                              >
                                <FileIcon type={a.type} />
                                <span className="max-w-[180px] truncate">{a.name || `${t.invoice} ${i + 1}`}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-[#1A1A1A]">{fmtUSD(l.amountUSD)}</p>
                          {l.currency === 'COP' && (
                            <p className="text-[11px]" style={{ color: 'rgba(26,26,26,0.4)' }}>
                              {fmtOriginal(l.frequency === 'per_checkout' && m ? Number(l.amount) * m.checkouts : Number(l.amount), l.currency)}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}

        {/* Unit utilities */}
        {utilities.length > 0 && (
          <div className="rounded-xl p-6 mb-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
            <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{t.unitUtilities} — {monthLabel(selected, locale)}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[#1A1A1A]/40 text-xs uppercase tracking-wider">
                    <th className="py-2">{t.colUnit}</th>
                    <th className="py-2">{t.concept}</th>
                    <th className="py-2 text-right">{t.amount}</th>
                    <th className="py-2 text-right">{t.receipt}</th>
                  </tr>
                </thead>
                <tbody>
                  {utilities.map(u => (
                    <tr key={u.id} className="border-t border-[#1A1A1A]/5">
                      <td className="py-2 text-[#1A1A1A]">
                        <Link href={`/dashboard/${u.property_id}/calculos?month=${selected}`} className="hover:text-[#833B0E]">{propName[u.property_id] ?? '—'}</Link>
                      </td>
                      <td className="py-2 text-[#1A1A1A]/70">{u.custom_type || u.utility_type}{u.reference ? ` · ${u.reference}` : ''}</td>
                      <td className="py-2 text-right text-[#1A1A1A]">{fmtOriginal(Number(u.amount) || 0, u.currency || 'COP')}</td>
                      <td className="py-2 text-right">
                        {u.receipt_url
                          ? <a href={u.receipt_url} target="_blank" rel="noopener noreferrer" className="text-xs" style={{ color: '#833B0E' }}>{t.receipt} ↗</a>
                          : <span className="text-xs" style={{ color: 'rgba(26,26,26,0.3)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Unit maintenance */}
        {maintenance.length > 0 && (
          <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
            <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{t.unitMaintenance} — {monthLabel(selected, locale)}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr className="text-left text-[#1A1A1A]/40 text-xs uppercase tracking-wider">
                    <th className="py-2">{t.date}</th>
                    <th className="py-2">{t.colUnit}</th>
                    <th className="py-2">{t.concept}</th>
                    <th className="py-2 text-right">{t.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenance.map(x => (
                    <tr key={x.id} className="border-t border-[#1A1A1A]/5">
                      <td className="py-2 text-[#1A1A1A]/60">{x.date}</td>
                      <td className="py-2 text-[#1A1A1A]">
                        <Link href={`/dashboard/${x.property_id}/timeline`} className="hover:text-[#833B0E]">{propName[x.property_id] ?? '—'}</Link>
                      </td>
                      <td className="py-2 text-[#1A1A1A]/70">{x.description || x.type || '—'}</td>
                      <td className="py-2 text-right text-[#1A1A1A]">{fmtOriginal(Number(x.amount) || 0, x.currency || 'USD')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {m && (
          <p className="text-[11px] mt-6" style={{ color: 'rgba(26,26,26,0.35)' }}>
            {tpl(t.trmNote, { month: monthLabel(selected, locale), trm: Math.round(m.trm).toLocaleString('en-US') })}
          </p>
        )}
      </section>
    </div>
  )
}

function Tile({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg px-3 py-3" style={{ backgroundColor: '#FFFFFF', border: `1px solid ${highlight ? 'rgba(131,59,14,0.4)' : 'rgba(26,26,26,0.08)'}` }}>
      <div className="text-lg font-semibold truncate" style={{ color: highlight ? '#833B0E' : '#1A1A1A' }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>{label}</div>
    </div>
  )
}
