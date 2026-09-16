import Link from 'next/link'
import { loadOwnerBuilding } from '@/lib/edificio'
import {
  computeBuildingPnl, reportedMonths, currentMonthKey, categoryMeta,
  fmtUSD, fmtCOP, monthLabel, type BuildingMonth,
} from '@/lib/building-pnl'
import { getLocale } from '@/lib/i18n'
import { edificioDict, tpl } from '@/lib/edificio-i18n'
import BuildingMonthPills from '@/components/edificio/BuildingMonthPills'

interface Props {
  params: Promise<{ configId: string }>
  searchParams: Promise<{ month?: string; year?: string }>
}

export const revalidate = 0

function pct(n: number) { return `${Math.round(n)}%` }

export default async function EdificioOverviewPage({ params, searchParams }: Props) {
  const { configId } = await params
  const { month: monthParam, year: yearParam } = await searchParams
  const { config, properties, sb } = await loadOwnerBuilding(configId)
  const locale = await getLocale()
  const t = edificioDict(locale)

  const nowKey = currentMonthKey()
  const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : Number((monthParam ?? nowKey).slice(0, 4))
  const months = reportedMonths(year, config.start_month)
  const selected = monthParam && months.includes(monthParam)
    ? monthParam
    : (months.includes(nowKey) ? nowKey : (months[months.length - 1] ?? nowKey))

  const pnl = await computeBuildingPnl(sb, config, properties, year)
  const m: BuildingMonth | undefined = pnl.months.find(x => x.month === selected)
  const minYear = config.start_month ? Number(config.start_month.slice(0, 4)) : undefined
  const activeUnits = properties.filter(p => p.active).length

  const basisLabel = pnl.config.thresholdBasis === 'gross' ? t.basisGross : t.basisNoi
  const thresholdText = !m ? '' : pnl.config.thresholdCop <= 0
    ? tpl(t.thresholdNoThreshold, { rate: pnl.config.commissionRate })
    : m.thresholdReached
      ? tpl(t.thresholdAbove, { basis: basisLabel, basisCop: fmtCOP(m.thresholdBasisCop), threshold: fmtCOP(pnl.config.thresholdCop), rate: pnl.config.commissionRate })
      : tpl(t.thresholdBelow, { basis: basisLabel, basisCop: fmtCOP(m.thresholdBasisCop), threshold: fmtCOP(pnl.config.thresholdCop) })
  const thresholdPct = m && pnl.config.thresholdCop > 0
    ? Math.max(0, Math.min(100, Math.round((m.thresholdBasisCop / pnl.config.thresholdCop) * 100)))
    : 100

  const categoryRows = m
    ? Object.entries(m.costs.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, meta: categoryMeta(k), usd: v }))
    : []
  const maxNoi = Math.max(1, ...pnl.months.map(x => Math.abs(x.noi)))

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F0EFED' }}>
      <section className="px-6 lg:px-10 py-10 max-w-6xl mx-auto">
        {/* Header */}
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
          {activeUnits} {t.units}{config.city ? ` · ${config.city}` : ''}
        </p>
        <h1 className="font-serif text-4xl font-light text-[#1A1A1A] mb-2">{config.name}</h1>
        <p className="text-sm mb-8" style={{ color: 'rgba(26,26,26,0.45)' }}>{t.subtitleOverview}</p>

        <div className="mb-8">
          <BuildingMonthPills year={year} selected={selected} months={months} minYear={minYear} locale={locale} />
        </div>

        {!m ? (
          <div className="rounded-xl p-8 text-center text-sm" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)', color: 'rgba(26,26,26,0.45)' }}>
            {t.noData}
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
              <Kpi value={fmtUSD(m.net)} label={t.kpiNet} />
              <Kpi value={`− ${fmtUSD(m.costs.total)}`} label={t.kpiCosts} tone="neg" />
              <Kpi value={fmtUSD(m.noi)} label={t.kpiNoi} />
              <Kpi value={fmtUSD(m.ownerNet)} label={t.kpiOwnerNet} highlight />
              <Kpi value={pct(m.occupancy)} label={t.kpiOcc} />
              <Kpi value={String(m.nights)} label={t.kpiNights} />
            </div>

            {m.isFuture && (
              <p className="text-xs mb-6 px-3 py-2 rounded-lg inline-block" style={{ backgroundColor: 'rgba(214,167,0,0.12)', color: '#7A5F00' }}>
                {t.future}
              </p>
            )}

            <div className="grid lg:grid-cols-5 gap-6 mb-8">
              {/* Statement */}
              <div className="lg:col-span-3 rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                <h2 className="font-serif text-2xl text-[#1A1A1A] mb-4">{t.statementTitle} — {monthLabel(selected, locale)}</h2>
                <Row label={t.grossFare} value={fmtUSD(m.gross)} muted />
                <Row label={t.channelFees} value={`− ${fmtUSD(m.channelFees)}`} muted deduct />
                <Row label={t.netRevenue} value={fmtUSD(m.net)} strong divider />
                {categoryRows.map(c => (
                  <Row key={c.key} label={locale === 'en' ? c.meta.labelEn : c.meta.label} value={`− ${fmtUSD(c.usd)}`} deduct dot={c.meta.color} />
                ))}
                {m.costs.utilities > 0 && <Row label={t.utilities} value={`− ${fmtUSD(m.costs.utilities)}`} deduct dot="#0E6845" />}
                {m.costs.maintenance > 0 && <Row label={t.maintenance} value={`− ${fmtUSD(m.costs.maintenance)}`} deduct dot="#833B0E" />}
                <Row label={t.totalCosts} value={`− ${fmtUSD(m.costs.total)}`} deduct strong />
                <Row label={t.noi} value={fmtUSD(m.noi)} strong divider />
                <Row label={`${t.nokCommission}${m.commissionRate > 0 ? ` (${m.commissionRate}%)` : ''}`} value={m.commission > 0 ? `− ${fmtUSD(m.commission)}` : fmtUSD(0)} deduct={m.commission > 0} />
                <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#1A1A1A]/10">
                  <span className="text-[#1A1A1A] font-medium">{t.ownerNet}</span>
                  <span className="text-xl font-semibold" style={{ color: m.ownerNet >= 0 ? '#0E6845' : '#F20022' }}>{fmtUSD(m.ownerNet)}</span>
                </div>
                <p className="text-[11px] mt-4" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  {tpl(t.trmNote, { month: monthLabel(selected, locale), trm: Math.round(m.trm).toLocaleString('en-US') })}
                </p>
                <Link href={`/dashboard/edificio/${configId}/costos?month=${selected}&year=${year}`} className="inline-block mt-4 text-sm font-medium" style={{ color: '#833B0E' }}>
                  {t.seeInvoices} →
                </Link>
              </div>

              {/* Threshold + costs mix */}
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                  <h3 className="text-sm font-semibold text-[#1A1A1A] mb-2">{t.thresholdTitle}</h3>
                  <p className="text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.65)' }}>{thresholdText}</p>
                  {pnl.config.thresholdCop > 0 && (
                    <div className="mt-4">
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(26,26,26,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${thresholdPct}%`, backgroundColor: m.thresholdReached ? '#833B0E' : '#0E6845' }} />
                      </div>
                      <div className="flex justify-between text-[11px] mt-1" style={{ color: 'rgba(26,26,26,0.4)' }}>
                        <span>{fmtCOP(Math.max(0, m.thresholdBasisCop))}</span>
                        <span>{fmtCOP(pnl.config.thresholdCop)}</span>
                      </div>
                    </div>
                  )}
                  {pnl.config.thresholdCop > 0 && pnl.config.commissionRate === 0 && (
                    <p className="text-[11px] mt-3" style={{ color: 'rgba(26,26,26,0.4)' }}>{t.thresholdRatePending}</p>
                  )}
                </div>

                {m.costs.total > 0 && (
                  <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                    <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">{t.kpiCosts}</h3>
                    <div className="space-y-2">
                      {[...categoryRows.map(c => ({ label: locale === 'en' ? c.meta.labelEn : c.meta.label, usd: c.usd, color: c.meta.color })),
                        ...(m.costs.utilities > 0 ? [{ label: t.utilities, usd: m.costs.utilities, color: '#0E6845' }] : []),
                        ...(m.costs.maintenance > 0 ? [{ label: t.maintenance, usd: m.costs.maintenance, color: '#833B0E' }] : []),
                      ].map(b => (
                        <div key={b.label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span style={{ color: 'rgba(26,26,26,0.6)' }}>{b.label}</span>
                            <span className="text-[#1A1A1A]">{fmtUSD(b.usd)} · {Math.round((b.usd / m.costs.total) * 100)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgba(26,26,26,0.05)' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.round((b.usd / m.costs.total) * 100)}%`, backgroundColor: b.color }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Monthly evolution */}
            <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
              <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{t.monthlyTitle} {year}</h2>
              <div className="flex items-end gap-1.5 h-24 mb-4">
                {pnl.months.map(x => {
                  const h = Math.max(2, Math.round((Math.abs(x.noi) / maxNoi) * 88))
                  const active = x.month === selected
                  return (
                    <Link key={x.month} href={`?month=${x.month}&year=${year}`} className="flex-1 flex flex-col justify-end items-center" title={`${monthLabel(x.month, locale)}: NOI ${fmtUSD(x.noi)}`}>
                      <div className="w-full rounded-t" style={{ height: `${h}px`, backgroundColor: x.noi < 0 ? '#F20022' : x.isFuture ? 'rgba(131,59,14,0.3)' : active ? '#833B0E' : '#0E6845', opacity: active ? 1 : 0.75 }} />
                      <span className="text-[10px] mt-1" style={{ color: active ? '#1A1A1A' : 'rgba(26,26,26,0.4)' }}>{monthLabel(x.month, locale).slice(0, 3)}</span>
                    </Link>
                  )
                })}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-[#1A1A1A]/40 text-xs uppercase tracking-wider">
                      <th className="py-2">{t.colMonth}</th>
                      <th className="py-2 text-right">{t.colNet}</th>
                      <th className="py-2 text-right">{t.colCosts}</th>
                      <th className="py-2 text-right">{t.colNoi}</th>
                      <th className="py-2 text-right">{t.colCommission}</th>
                      <th className="py-2 text-right">{t.colOwner}</th>
                      <th className="py-2 text-right">{t.colOcc}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.months.map(x => (
                      <tr key={x.month} className="border-t border-[#1A1A1A]/5" style={{ backgroundColor: x.month === selected ? 'rgba(131,59,14,0.05)' : 'transparent' }}>
                        <td className="py-2 text-[#1A1A1A]">
                          <Link href={`?month=${x.month}&year=${year}`} className="hover:text-[#833B0E]">{monthLabel(x.month, locale)}</Link>
                          {x.isFuture && <span className="ml-2 text-[10px] uppercase tracking-wide" style={{ color: 'rgba(26,26,26,0.35)' }}>{t.projection}</span>}
                        </td>
                        <td className="py-2 text-right text-[#1A1A1A]/80">{fmtUSD(x.net)}</td>
                        <td className="py-2 text-right text-[#F20022]/80">− {fmtUSD(x.costs.total)}</td>
                        <td className="py-2 text-right text-[#1A1A1A]">{fmtUSD(x.noi)}</td>
                        <td className="py-2 text-right text-[#1A1A1A]/60">{x.commission > 0 ? `− ${fmtUSD(x.commission)}` : '—'}</td>
                        <td className="py-2 text-right font-medium" style={{ color: x.ownerNet >= 0 ? '#0E6845' : '#F20022' }}>{fmtUSD(x.ownerNet)}</td>
                        <td className="py-2 text-right text-[#1A1A1A]/60">{pct(x.occupancy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per unit */}
            <div className="rounded-xl p-6 mb-8" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
              <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{t.unitsTitle} — {monthLabel(selected, locale)}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-[#1A1A1A]/40 text-xs uppercase tracking-wider">
                      <th className="py-2">{t.colUnit}</th>
                      <th className="py-2 text-right">{t.colRes}</th>
                      <th className="py-2 text-right">{t.colNights}</th>
                      <th className="py-2 text-right">{t.colOcc}</th>
                      <th className="py-2 text-right">{t.colAdr}</th>
                      <th className="py-2 text-right">{t.colNet}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pnl.properties.map(p => {
                      const pm = p.byMonth[selected]
                      return (
                        <tr key={p.id} className="border-t border-[#1A1A1A]/5">
                          <td className="py-2 text-[#1A1A1A]">
                            <Link href={`/dashboard/${p.id}/overview`} className="hover:text-[#833B0E]">{p.name}</Link>
                            {!p.active && <span className="ml-2 text-[10px] uppercase" style={{ color: 'rgba(26,26,26,0.35)' }}>inactiva</span>}
                          </td>
                          <td className="py-2 text-right text-[#1A1A1A]/60">{pm?.reservations ?? 0}</td>
                          <td className="py-2 text-right text-[#1A1A1A]/60">{pm?.nights ?? 0}</td>
                          <td className="py-2 text-right text-[#1A1A1A]/60">{pct(pm?.occupancy ?? 0)}</td>
                          <td className="py-2 text-right text-[#1A1A1A]/60">{pm && pm.nights > 0 ? fmtUSD(pm.adr) : '—'}</td>
                          <td className="py-2 text-right text-[#1A1A1A]">{fmtUSD(pm?.net ?? 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* YTD */}
              <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{tpl(t.ytdTitle, { year })}</h2>
                <Row label={t.netRevenue} value={fmtUSD(pnl.ytd.net)} />
                <Row label={t.totalCosts} value={`− ${fmtUSD(pnl.ytd.costs.total)}`} deduct />
                <Row label={t.noi} value={fmtUSD(pnl.ytd.noi)} strong divider />
                <Row label={t.nokCommission} value={pnl.ytd.commission > 0 ? `− ${fmtUSD(pnl.ytd.commission)}` : fmtUSD(0)} deduct={pnl.ytd.commission > 0} />
                <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#1A1A1A]/10">
                  <span className="text-[#1A1A1A] font-medium">{t.ownerNet}</span>
                  <span className="text-xl font-semibold" style={{ color: pnl.ytd.ownerNet >= 0 ? '#0E6845' : '#F20022' }}>{fmtUSD(pnl.ytd.ownerNet)}</span>
                </div>
                <p className="text-[11px] mt-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  {t.kpiOcc} {pct(pnl.ytd.occupancy)} · {t.colAdr} {fmtUSD(pnl.ytd.adr)} · {t.colNights} {pnl.ytd.nights}
                </p>
              </div>

              {/* Channels */}
              <div className="rounded-xl p-6" style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.08)' }}>
                <h2 className="font-serif text-xl text-[#1A1A1A] mb-4">{t.channelsTitle}</h2>
                {pnl.channels.length === 0 ? (
                  <p className="text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>—</p>
                ) : (
                  <div className="space-y-2">
                    {pnl.channels.map(c => {
                      const total = pnl.channels.reduce((s, x) => s + x.net, 0) || 1
                      return (
                        <div key={c.channel}>
                          <div className="flex justify-between text-xs mb-1">
                            <span style={{ color: 'rgba(26,26,26,0.6)' }}>{c.channel} · {c.reservations}</span>
                            <span className="text-[#1A1A1A]">{fmtUSD(c.net)} · {Math.round((c.net / total) * 100)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full" style={{ backgroundColor: 'rgba(26,26,26,0.05)' }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.round((c.net / total) * 100)}%`, backgroundColor: '#833B0E' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function Kpi({ value, label, highlight, tone }: { value: string; label: string; highlight?: boolean; tone?: 'neg' }) {
  return (
    <div className="rounded-lg px-3 py-3" style={{ backgroundColor: '#FFFFFF', border: `1px solid ${highlight ? 'rgba(14,104,69,0.4)' : 'rgba(26,26,26,0.08)'}` }}>
      <div className="text-lg font-semibold truncate" style={{ color: highlight ? '#0E6845' : tone === 'neg' ? 'rgba(242,0,34,0.8)' : '#1A1A1A' }}>{value}</div>
      <div className="text-[11px] mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>{label}</div>
    </div>
  )
}

function Row({ label, value, deduct, strong, muted, divider, dot }: { label: string; value: string; deduct?: boolean; strong?: boolean; muted?: boolean; divider?: boolean; dot?: string }) {
  return (
    <div className={`flex items-center justify-between py-2 ${divider ? 'border-t border-[#1A1A1A]/10 mt-1 pt-3' : ''}`}>
      <span className={`text-sm flex items-center gap-2 ${strong ? 'text-[#1A1A1A] font-medium' : ''}`} style={{ color: strong ? undefined : muted ? 'rgba(26,26,26,0.45)' : 'rgba(26,26,26,0.7)' }}>
        {dot && <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />}
        {label}
      </span>
      <span className={`text-sm ${strong ? 'font-semibold text-[#1A1A1A]' : ''}`} style={{ color: strong ? undefined : deduct ? 'rgba(242,0,34,0.8)' : muted ? 'rgba(26,26,26,0.5)' : '#1A1A1A' }}>{value}</span>
    </div>
  )
}
