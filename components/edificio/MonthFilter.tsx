'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

/** Input de mes (YYYY-MM) que actualiza ?month= en la URL. */
export default function MonthFilter({ value }: { value: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = new URLSearchParams(params.toString())
    if (e.target.value) next.set('month', e.target.value)
    else next.delete('month')
    const qs = next.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <input
      type="month"
      value={value}
      onChange={onChange}
      className="rounded-xl px-3 py-2 text-sm outline-none cursor-pointer max-w-full"
      style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.12)', color: '#1A1A1A' }}
    />
  )
}
