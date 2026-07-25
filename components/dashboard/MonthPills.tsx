'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const MONTH_NAMES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']

interface Props {
  year: number
  selected: string // YYYY-MM
}

export default function MonthPills({ year, selected }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function selectMonth(key: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', key)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MONTH_NAMES.map((name, i) => {
        const key = `${year}-${String(i + 1).padStart(2, '0')}`
        const active = key === selected
        return (
          <button
            key={key}
            onClick={() => selectMonth(key)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer"
            style={{
              backgroundColor: active ? 'rgba(131, 59, 14,0.25)' : 'rgba(26,26,26,0.04)',
              border: `1px solid ${active ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
              color: active ? '#1A1A1A' : 'rgba(26,26,26,0.55)',
            }}
          >
            {name} {String(year).slice(2)}
          </button>
        )
      })}
    </div>
  )
}
