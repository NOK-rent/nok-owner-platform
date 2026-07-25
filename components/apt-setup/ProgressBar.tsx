'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'

const STEPS = [
  { key: 'info', label: 'Datos', href: '/apt-setup' },
  { key: 'check', label: 'Check', href: '/apt-setup/check' },
  { key: 'photos', label: 'Fotos', href: '/apt-setup/photos' },
  { key: 'quote', label: 'Cotización', href: '/apt-setup/quote' },
]

export default function ProgressBar() {
  const pathname = usePathname()

  const currentIdx = STEPS.findIndex(s => {
    if (s.href === '/apt-setup') return pathname === '/apt-setup'
    return pathname.startsWith(s.href)
  })

  return (
    <nav className="flex items-center justify-center gap-0" aria-label="Progress">
      {STEPS.map((step, i) => {
        const isActive = i === currentIdx
        const isDone = i < currentIdx
        const isClickable = isDone

        const content = (
          <div className="flex items-center gap-2">
            <span
              className={`
                w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300
                ${isDone
                  ? 'bg-[#D6A700] text-[#F0EFED]'
                  : isActive
                    ? 'bg-[#1A1A1A] text-[#F0EFED]'
                    : 'bg-[#E5E3DF] text-[rgba(26,26,26,0.35)]'
                }
              `}
            >
              {isDone ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className={`
                text-sm font-medium transition-all duration-300 hidden sm:block
                ${isActive ? 'text-[#1A1A1A]' : isDone ? 'text-[rgba(26,26,26,0.6)]' : 'text-[rgba(26,26,26,0.25)]'}
              `}
            >
              {step.label}
            </span>
          </div>
        )

        return (
          <div key={step.key} className="flex items-center">
            {i > 0 && (
              <div
                className={`w-8 sm:w-12 h-px mx-2 transition-colors duration-300 ${
                  i <= currentIdx ? 'bg-[#D6A700]' : 'bg-[#E5E3DF]'
                }`}
              />
            )}
            {isClickable ? (
              <Link href={step.href} className="hover:opacity-80 transition-opacity">
                {content}
              </Link>
            ) : (
              <div className={isActive ? '' : 'opacity-100'}>{content}</div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
