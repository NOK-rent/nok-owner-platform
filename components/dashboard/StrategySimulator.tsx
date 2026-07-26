'use client'

/**
 * What-if simulator for the Strategy tab: the owner moves the positioning
 * slider and sees how the next 90 nights of recommendations would change.
 * Simulation only — nothing is ever applied from here.
 */

import { useState } from 'react'

interface Props {
  propertyId: string
  currentPct: number // current base price adjustment, e.g. -10
  en: boolean
}

interface PreviewDay { date: string; current: number; simulated: number }
interface PreviewResult { pct: number; days: PreviewDay[]; avgCurrent: number; avgSimulated: number }

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (iso: string, en: boolean) => {
  const [, m, d] = iso.split('-')
  return en ? `${MONTHS_SHORT[+m - 1]} ${+d}` : `${+d} ${MESES_CORTOS[+m - 1]}`
}

function PreviewChart({ days, en }: { days: PreviewDay[]; en: boolean }) {
  const W = 860, H = 220, P = { t: 12, r: 12, b: 26, l: 46 }
  const ys = days.flatMap(d => [d.current, d.simulated])
  const step = Math.max(25, Math.ceil((Math.max(...ys) - Math.min(...ys)) / 150) * 50)
  const yMin = Math.floor(Math.min(...ys) / step) * step
  const yMax = Math.ceil(Math.max(...ys) / step) * step
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (days.length - 1)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - yMin) / (yMax - yMin || 1))
  const line = (k: 'current' | 'simulated') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join('')
  const grid: number[] = []
  for (let v = yMin; v <= yMax; v += step) grid.push(v)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={en ? 'Current vs simulated rate' : 'Tarifa actual vs simulada'}>
      {grid.map(v => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(26,26,26,0.07)" strokeWidth={1} />
          <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="rgba(26,26,26,0.35)">${v}</text>
        </g>
      ))}
      {days.map((d, i) =>
        i % 14 === 0 ? <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(26,26,26,0.35)">{fmtDay(d.date, en)}</text> : null,
      )}
      <path d={line('current')} fill="none" stroke="rgba(26,26,26,0.35)" strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" />
      <path d={line('simulated')} fill="none" stroke="#833B0E" strokeWidth={2.2} strokeLinejoin="round" />
    </svg>
  )
}

export function StrategySimulator({ propertyId, currentPct, en }: Props) {
  const [pct, setPct] = useState(currentPct)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [error, setError] = useState(false)

  async function simulate() {
    setLoading(true); setError(false)
    try {
      const res = await fetch('/api/strategy/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, adjustmentPct: pct }),
      })
      if (!res.ok) throw new Error()
      setResult(await res.json())
    } catch {
      setError(true); setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const deltaPct = result ? Math.round(((result.avgSimulated - result.avgCurrent) / result.avgCurrent) * 100) : null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-5 mb-4">
        <div className="flex-1 min-w-56">
          <div className="flex justify-between text-xs mb-1" style={{ color: 'rgba(26,26,26,0.45)' }}>
            <span>{en ? 'Positioning vs. engine recommendation' : 'Posicionamiento vs. recomendación del motor'}</span>
            <span className="font-medium text-[#1A1A1A] tabular-nums">{pct > 0 ? '+' : ''}{pct}%</span>
          </div>
          <input
            type="range" min={-30} max={30} step={5} value={pct}
            onChange={e => setPct(Number(e.target.value))}
            className="w-full accent-[#833B0E]"
            aria-label={en ? 'Positioning percentage' : 'Porcentaje de posicionamiento'}
          />
          <div className="flex justify-between text-[10px]" style={{ color: 'rgba(26,26,26,0.3)' }}>
            <span>−30% · {en ? 'more occupancy' : 'más ocupación'}</span>
            <span>{en ? 'current' : 'actual'}: {currentPct > 0 ? '+' : ''}{currentPct}%</span>
            <span>+30% · {en ? 'more rate' : 'más tarifa'}</span>
          </div>
        </div>
        <button
          onClick={simulate}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity cursor-pointer disabled:opacity-50"
          style={{ backgroundColor: '#1A1A1A', color: '#F0EFED' }}
        >
          {loading ? (en ? 'Simulating…' : 'Simulando…') : (en ? 'Simulate' : 'Simular')}
        </button>
      </div>

      {error && (
        <p className="text-sm" style={{ color: '#833B0E' }}>
          {en ? 'The simulation is not available right now. Try again in a minute.' : 'La simulación no está disponible en este momento. Intenta de nuevo en un minuto.'}
        </p>
      )}

      {result && (
        <div>
          <div className="flex flex-wrap items-end gap-6 mb-3">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{en ? 'Avg rate today (next 90 nights)' : 'Tarifa promedio hoy (próx. 90 noches)'}</p>
              <p className="font-serif text-3xl font-light text-[#1A1A1A]">${result.avgCurrent}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(26,26,26,0.35)' }}>{en ? 'Simulated' : 'Simulada'}</p>
              <p className="font-serif text-3xl font-light" style={{ color: '#833B0E' }}>
                ${result.avgSimulated}
                {deltaPct != null && deltaPct !== 0 && <span className="text-base ml-2">({deltaPct > 0 ? '+' : ''}{deltaPct}%)</span>}
              </p>
            </div>
          </div>
          <PreviewChart days={result.days} en={en} />
          <div className="flex gap-5 mt-2 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
            <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-0.5" style={{ borderTop: '2px dashed rgba(26,26,26,0.35)' }} /> {en ? 'Current' : 'Actual'}</span>
            <span className="flex items-center gap-2"><span className="inline-block w-3.5 h-1 rounded-full" style={{ backgroundColor: '#833B0E' }} /> {en ? 'Simulated' : 'Simulada'}</span>
          </div>
          <p className="text-xs mt-3 leading-relaxed" style={{ color: 'rgba(26,26,26,0.35)' }}>
            {en
              ? 'Simulation only — nothing changes on your listing. Price floors and season rules still apply, which is why some nights move less than the slider. A higher rate can also mean fewer bookings; the NOK team balances both. Want to discuss a change? Ask NOK AI or the team.'
              : 'Es solo una simulación — nada cambia en tu listing. Los pisos de precio y las reglas de temporada se siguen respetando, por eso algunas noches se mueven menos que el slider. Una tarifa más alta también puede significar menos reservas; el equipo NOK balancea ambas. ¿Quieres conversar un cambio? Escríbele a NOK AI o al equipo.'}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Year vs market (interactive bars) ───────────────────────────────────────

export function YearVsMarketChart({ months, en }: { months: { month: string; unit: number | null; market: number | null }[]; en: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const data = months.filter(m => m.unit != null || m.market != null)
  if (data.length < 3) return null
  const W = 860, H = 260, P = { t: 16, r: 12, b: 30, l: 46 }
  const groupW = (W - P.l - P.r) / data.length
  const barW = Math.min(22, groupW / 2 - 4)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v)
  const fmtM = (ym: string) => {
    const [yy, mm] = ym.split('-')
    return en ? `${MONTHS_SHORT[+mm - 1]}` : `${MESES_CORTOS[+mm - 1]}`
  }
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={en ? 'Monthly occupancy: your unit vs the market' : 'Ocupación mensual: tu unidad vs el mercado'}>
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(26,26,26,0.07)" strokeWidth={1} />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="rgba(26,26,26,0.35)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {data.map((m, i) => {
          const cx = P.l + i * groupW + groupW / 2
          return (
            <g key={m.month} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={P.l + i * groupW} y={P.t} width={groupW} height={H - P.t - P.b} fill={hover === i ? 'rgba(26,26,26,0.03)' : 'transparent'} />
              {m.unit != null && (
                <rect x={cx - barW - 2} y={y(m.unit)} width={barW} height={Math.max(2, y(0) - y(m.unit))} rx={3} fill="#0E6845" />
              )}
              {m.market != null && (
                <rect x={cx + 2} y={y(m.market)} width={barW} height={Math.max(2, y(0) - y(m.market))} rx={3} fill="rgba(0,128,198,0.55)" />
              )}
              {hover === i && (
                <text x={cx} y={P.t + 2} textAnchor="middle" fontSize={11} fill="#1A1A1A">
                  {(m.unit != null ? `${en ? 'You' : 'Tú'} ${Math.round(m.unit * 100)}%` : '')}{m.unit != null && m.market != null ? ' · ' : ''}{m.market != null ? `${en ? 'Market' : 'Mercado'} ${Math.round(m.market * 100)}%` : ''}
                </text>
              )}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={11} fill="rgba(26,26,26,0.35)">{fmtM(m.month)}</text>
            </g>
          )
        })}
      </svg>
      <div className="flex gap-5 mt-1 text-xs" style={{ color: 'rgba(26,26,26,0.45)' }}>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#0E6845' }} /> {en ? 'Your unit' : 'Tu unidad'}</span>
        <span className="flex items-center gap-2"><span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: 'rgba(0,128,198,0.55)' }} /> {en ? 'Market (same bedrooms)' : 'Mercado (mismas habitaciones)'}</span>
      </div>
    </div>
  )
}
