'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface Props {
  year: number
  selected: string          // YYYY-MM
  months: string[]          // meses reportados del año (YYYY-MM)
  minYear?: number
  locale?: 'es' | 'en'
}

/** Pills de mes limitadas a los meses reportados del edificio + flechas de año. */
export default function BuildingMonthPills({ year, selected, months, minYear, locale = 'es' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const names = locale === 'en' ? EN : ES

  function go(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(next)) params.set(k, v)
    router.push(`${pathname}?${params.toString()}`)
  }

  const canPrev = minYear == null || year > minYear
  const canNext = year < new Date().getFullYear() + 1

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => canPrev && go({ year: String(year - 1), month: `${year - 1}-12` })}
        disabled={!canPrev}
        className="w-8 h-8 rounded-lg text-sm disabled:opacity-30 cursor-pointer"
        style={{ border: '1px solid rgba(26,26,26,0.1)', color: 'rgba(26,26,26,0.6)' }}
        aria-label="Año anterior"
      >‹</button>
      <span className="text-sm font-medium text-[#1A1A1A] w-12 text-center">{year}</span>
      <button
        onClick={() => canNext && go({ year: String(year + 1), month: `${year + 1}-01` })}
        disabled={!canNext}
        className="w-8 h-8 rounded-lg text-sm disabled:opacity-30 cursor-pointer"
        style={{ border: '1px solid rgba(26,26,26,0.1)', color: 'rgba(26,26,26,0.6)' }}
        aria-label="Año siguiente"
      >›</button>
      <div className="h-5 w-px mx-1" style={{ backgroundColor: 'rgba(26,26,26,0.1)' }} />
      {months.length === 0 && (
        <span className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>
          {locale === 'en' ? 'No reported months this year' : 'Sin meses reportados este año'}
        </span>
      )}
      {months.map(key => {
        const i = Number(key.slice(5, 7)) - 1
        const active = key === selected
        return (
          <button
            key={key}
            onClick={() => go({ month: key, year: String(year) })}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer"
            style={{
              backgroundColor: active ? 'rgba(131, 59, 14,0.25)' : 'rgba(26,26,26,0.04)',
              border: `1px solid ${active ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
              color: active ? '#1A1A1A' : 'rgba(26,26,26,0.55)',
            }}
          >
            {names[i]}
          </button>
        )
      })}
    </div>
  )
}
