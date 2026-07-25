import Link from 'next/link'
import { redirect } from 'next/navigation'
import { verifyOnboardingToken } from '@/lib/onboarding-token'

interface Props {
  searchParams: Promise<{ token?: string }>
}

const SUPPORT_EMAIL = process.env.NOK_SUPPORT_EMAIL || 'hello@nok.rent'

export default async function OnboardingAccessPage({ searchParams }: Props) {
  const { token } = await searchParams

  if (token) {
    const payload = verifyOnboardingToken(token)
    if (payload) {
      redirect('/login')
    }
  }

  // Invalid / expired — show the guidance required by the spec (section 3,
  // "portal_link_token inválido o expirado"), not a generic 404.
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#F0EFED' }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(131, 59, 14,0.18) 0%, transparent 70%)',
        }}
      />
      <div className="relative z-10 w-full max-w-md text-center">
        <p
          className="font-serif text-5xl font-light tracking-[0.3em] text-[#1A1A1A] mb-3"
        >
          NOK
        </p>
        <p style={{ color: 'rgba(26,26,26,0.35)', letterSpacing: '0.15em' }} className="text-xs uppercase mb-10">
          NOK Owners &nbsp;·&nbsp; Feels right. Anywhere.
        </p>

        <div
          className="rounded-2xl p-8"
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(26,26,26,0.07)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
          }}
        >
          <h1 className="font-serif text-2xl font-light text-[#1A1A1A] mb-4">
            This link has expired.
          </h1>
          <p className="text-sm mb-6" style={{ color: 'rgba(26,26,26,0.55)', lineHeight: 1.6 }}>
            Your onboarding link is no longer valid. Contact your NOK account manager at{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[#833B0E] hover:text-[#1A1A1A] transition-colors">
              {SUPPORT_EMAIL}
            </a>{' '}
            to receive a new one.
          </p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ backgroundColor: '#833B0E' }}
          >
            Go to login
          </Link>
        </div>
      </div>
    </div>
  )
}
