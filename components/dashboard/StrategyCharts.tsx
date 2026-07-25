'use client'

/**
 * Interactive charts for the Strategy (Revenue Management) tab.
 * Hover crosshair + tooltip and a 30/60/90-day range toggle.
 * Light NOK theme (#F0EFED ground, green unit / blue zone), matches the
 * server-rendered originals pixel-for-pixel except for interactivity.
 */

import { useMemo, useRef, useState } from 'react'

interface RateDayLite {
  date: string
  ours: number | null
  zoneMedian: number | null
  zoneLow: number | null
  zoneHigh: number | null
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDay(iso: string, en: boolean) {
  const [, m, d] = iso.split('-')
  return en ? `${MONTHS_SHORT[+m - 1]} ${+d}` : `${+d} ${MESES_CORTOS[+m - 1]}`
}

function fmtDayLong(iso: string, en: boolean) {
  const dt = new Date(iso + 'T00:00:00')
  return dt.toLocaleDateString(en ? 'en-US' : 'es-DO', { weekday: 'short', day: 'numeric', month: 'short' })
}

function RangeToggle({ range, setRange, max, en }: { range: number; setRange: (n: number) => void; max: number; en: boolean }) {
  const opts = [30, 60, 90].filter(n => n <= Math.max(30, max))
  if (opts.length < 2) return null
  return (
    <div className="flex gap-1">
      {opts.map(n => (
        <button
          key={n}
          onClick={() => setRange(n)}
          className="px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer"
          style={{
            backgroundColor: range === n ? '#1A1A1A' : 'rgba(26,26,26,0.05)',
            color: range === n ? '#F0EFED' : 'rgba(26,26,26,0.55)',
          }}
        >
          {n} {en ? 'days' : 'días'}
        </button>
      ))}
    </div>
  )
}

interface TooltipState {
  x: number
  y: number
  lines: string[]
  title: string
}

function useTooltip() {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const node = tip ? (
    <div
      className="absolute z-20 pointer-events-none rounded-lg px-3 py-2 text-xs leading-relaxed shadow-lg"
      style={{
        left: Math.min(tip.x + 12, (boxRef.current?.clientWidth ?? 600) - 170),
        top: tip.y + 12,
        backgroundColor: '#1A1A1A',
        color: '#F0EFED',
        fontVariantNumeric: 'tabular-nums',
        maxWidth: 220,
      }}
    >
      <p className="font-medium mb-0.5">{tip.title}</p>
      {tip.lines.map(l => <p key={l}>{l}</p>)}
    </div>
  ) : null
  return { tip, setTip, boxRef, node }
}

// ── Rate vs zone ────────────────────────────────────────────────────────────

export function RateChartInteractive({ days, en }: { days: RateDayLite[]; en: boolean }) {
  const [range, setRange] = useState(60)
  const { setTip, boxRef, node } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)

  const pts = useMemo(() => days.filter(d => d.zoneMedian != null).slice(0, range), [days, range])
  if (pts.length < 7) return null

  const W = 860, H = 280, P = { t: 12, r: 12, b: 28, l: 46 }
  const ys = pts.flatMap(d => [d.zoneLow, d.zoneHigh, d.ours, d.zoneMedian]).filter((v): v is number => v != null)
  const step = Math.max(25, Math.ceil((Math.max(...ys) - Math.min(...ys)) / 200) * 50)
  const yMin = Math.floor(Math.min(...ys) / step) * step
  const yMax = Math.ceil(Math.max(...ys) / step) * step
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - (v - yMin) / (yMax - yMin || 1))

  const line = (key: 'ours' | 'zoneMedian') =>
    pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y((d[key] ?? d.zoneMedian) as number).toFixed(1)}`).join('')
  const band =
    pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y((d.zoneHigh ?? d.zoneMedian) as number).toFixed(1)}`).join('') +
    [...pts].reverse().map((d, i) => `L${x(pts.length - 1 - i).toFixed(1)},${y((pts[pts.length - 1 - i].zoneLow ?? pts[pts.length - 1 - i].zoneMedian) as number).toFixed(1)}`).join('') +
    'Z'

  const [hoverI, setHoverI] = useState<number | null>(null)
  const gridVals: number[] = []
  for (let v = yMin; v <= yMax; v += step) gridVals.push(v)
  const tickEvery = range > 60 ? 14 : 10

  function onMove(ev: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    const box = boxRef.current
    if (!svg || !box) return
    const r = svg.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (pts.length - 1))))
    setHoverI(i)
    const d = pts[i]
    const b = box.getBoundingClientRect()
    setTip({
      x: ev.clientX - b.left,
      y: ev.clientY - b.top,
      title: fmtDayLong(d.date, en),
      lines: [
        `${en ? 'Your rate' : 'Tu tarifa'}: ${d.ours != null ? `$${Math.round(d.ours)}` : '—'}`,
        `${en ? 'Area median' : 'Mediana zona'}: $${Math.round(d.zoneMedian as number)}`,
        `${en ? 'Area range' : 'Rango zona'}: $${Math.round(d.zoneLow ?? 0)} – $${Math.round(d.zoneHigh ?? 0)}`,
      ],
    })
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex justify-end mb-2">
        <RangeToggle range={range} setRange={setRange} max={days.length} en={en} />
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={en ? 'Your rate compared to the area median and range' : 'Tu tarifa comparada con la mediana y el rango de la zona'}
        onPointerMove={onMove}
        onPointerLeave={() => { setHoverI(null); setTip(null) }}
      >
        {gridVals.map(v => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(26,26,26,0.07)" strokeWidth={1} />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="rgba(26,26,26,0.35)">${v}</text>
          </g>
        ))}
        {pts.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="rgba(26,26,26,0.35)">{fmtDay(d.date, en)}</text>
          ) : null,
        )}
        <path d={band} fill="rgba(148,184,207,0.14)" />
        <path d={line('zoneMedian')} fill="none" stroke="#0080C6" strokeWidth={2} strokeLinejoin="round" />
        <path d={line('ours')} fill="none" stroke="#0E6845" strokeWidth={2.5} strokeLinejoin="round" />
        {hoverI != null && (
          <g>
            <line x1={x(hoverI)} x2={x(hoverI)} y1={P.t} y2={H - P.b} stroke="rgba(26,26,26,0.3)" strokeWidth={1} strokeDasharray="3 3" />
            {pts[hoverI].ours != null && <circle cx={x(hoverI)} cy={y(pts[hoverI].ours as number)} r={4.5} fill="#0E6845" stroke="#FFFFFF" strokeWidth={2} />}
            <circle cx={x(hoverI)} cy={y(pts[hoverI].zoneMedian as number)} r={4.5} fill="#0080C6" stroke="#FFFFFF" strokeWidth={2} />
          </g>
        )}
      </svg>
      {node}
    </div>
  )
}

// ── Zone occupancy + our booked nights ──────────────────────────────────────

export function OccDailyChartInteractive({ zone, booked, en }: { zone: { date: string; occ: number }[]; booked: string[]; en: boolean }) {
  const [range, setRange] = useState(60)
  const { setTip, boxRef, node } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const bookedSet = useMemo(() => new Set(booked), [booked])
  const pts = useMemo(() => zone.slice(0, range), [zone, range])
  const [hoverI, setHoverI] = useState<number | null>(null)
  if (pts.length < 7) return null

  const W = 860, H = 240, P = { t: 12, r: 12, b: 52, l: 46 }
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / (pts.length - 1)
  const y = (v: number) => P.t + (H - P.t - P.b) * (1 - v)
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.occ).toFixed(1)}`).join('')
  const area = line + `L${x(pts.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`
  const stripY = H - P.b + 18
  const bw = (W - P.l - P.r) / pts.length
  const tickEvery = range > 60 ? 14 : 10

  function onMove(ev: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current
    const box = boxRef.current
    if (!svg || !box) return
    const r = svg.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(((px - P.l) / (W - P.l - P.r)) * (pts.length - 1))))
    setHoverI(i)
    const d = pts[i]
    const b = box.getBoundingClientRect()
    const isBooked = bookedSet.has(d.date)
    setTip({
      x: ev.clientX - b.left,
      y: ev.clientY - b.top,
      title: fmtDayLong(d.date, en),
      lines: [
        `${en ? 'Area booked' : 'Zona reservada'}: ${Math.round(d.occ * 100)}%`,
        isBooked
          ? (en ? 'Your unit: booked ✓' : 'Tu unidad: reservada ✓')
          : (en ? 'Your unit: available' : 'Tu unidad: disponible'),
      ],
    })
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex justify-end mb-2">
        <RangeToggle range={range} setRange={setRange} max={zone.length} en={en} />
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label={en ? 'Daily area occupancy and your booked nights' : 'Ocupación diaria de la zona y tus noches ya reservadas'}
        onPointerMove={onMove}
        onPointerLeave={() => { setHoverI(null); setTip(null) }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <g key={v}>
            <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="rgba(26,26,26,0.07)" strokeWidth={1} />
            <text x={P.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="rgba(26,26,26,0.35)">{Math.round(v * 100)}%</text>
          </g>
        ))}
        {pts.map((d, i) =>
          i % tickEvery === 0 ? (
            <text key={d.date} x={x(i)} y={H - 26} textAnchor="middle" fontSize={11} fill="rgba(26,26,26,0.35)">{fmtDay(d.date, en)}</text>
          ) : null,
        )}
        <path d={area} fill="rgba(61,155,209,0.10)" />
        <path d={line} fill="none" stroke="#0080C6" strokeWidth={2} strokeLinejoin="round" />
        <text x={P.l - 8} y={stripY + 8} textAnchor="end" fontSize={10} fill="rgba(26,26,26,0.35)">{en ? 'Your nights' : 'Tus noches'}</text>
        {pts.map((d, i) => (
          <rect
            key={d.date}
            x={x(i) - bw / 2 + 0.5}
            y={stripY}
            width={Math.max(1.5, bw - 1)}
            height={10}
            rx={2}
            fill={bookedSet.has(d.date) ? '#0E6845' : 'rgba(26,26,26,0.08)'}
            opacity={hoverI === i ? 0.7 : 1}
          />
        ))}
        {hoverI != null && (
          <g>
            <line x1={x(hoverI)} x2={x(hoverI)} y1={P.t} y2={stripY + 10} stroke="rgba(26,26,26,0.3)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(hoverI)} cy={y(pts[hoverI].occ)} r={4.5} fill="#0080C6" stroke="#FFFFFF" strokeWidth={2} />
          </g>
        )}
      </svg>
      {node}
    </div>
  )
}
