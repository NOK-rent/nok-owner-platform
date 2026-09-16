'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Props {
  units: { id: string; name: string }[]
  value: string | null
  allLabel?: string
}

/** Select de unidad que actualiza ?unit= en la URL (conserva el resto de parámetros). */
export default function UnitFilter({ units, value, allLabel = 'Todas las unidades' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = new URLSearchParams(params.toString())
    if (e.target.value) next.set('unit', e.target.value)
    else next.delete('unit')
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={value ?? ''}
      onChange={onChange}
      className="rounded-xl px-3 py-2 text-sm outline-none cursor-pointer max-w-full"
      style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.12)', color: '#1A1A1A' }}
    >
      <option value="">{allLabel}</option>
      {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
    </select>
  )
}
