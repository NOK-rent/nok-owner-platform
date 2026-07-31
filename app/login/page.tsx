'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const router  = useRouter()
  const supabase = createClient()

  // Si el usuario YA tiene una sesión válida, saltamos al dashboard desde el
  // cliente. El browser client refresca y persiste las cookies correctamente
  // (a diferencia del server client dentro de un Server Component), así que
  // esto no puede desincronizar tokens ni entrar en bucle: solo redirige
  // cuando getUser() confirma un usuario real; si la sesión está muerta,
  // devuelve null y nos quedamos en el login. El middleware ya NO hace este
  // salto para evitar el ping-pong /login <-> /dashboard.
  useEffect(() => {
    let cancelled = false
    async function redirectIfLoggedIn() {
      const { data, error } = await supabase.auth.getUser()
      if (!cancelled && !error && data.user) {
        router.replace('/dashboard')
      }
    }
    redirectIfLoggedIn()
    return () => { cancelled = true }
  }, [router, supabase])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Correo o contraseña incorrectos. Intenta de nuevo.')
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#F0EFED' }}
    >
      {/* Subtle purple glow backdrop */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(131, 59, 14,0.18) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <p
            className="font-serif text-5xl font-light tracking-[0.3em] text-[#1A1A1A] mb-3"
          >
            NOK
          </p>
          <p style={{ color: 'rgba(26,26,26,0.35)', letterSpacing: '0.15em' }} className="text-xs uppercase">
            NOK Owners &nbsp;·&nbsp; Feels right. Anywhere.
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8"
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid rgba(26,26,26,0.07)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
          }}
        >
          <h1 className="font-serif text-3xl font-light text-[#1A1A1A] mb-1">
            Your property. Always in view.
          </h1>
          <p className="text-sm mb-8" style={{ color: 'rgba(26,26,26,0.4)' }}>
            Performance, reservations and financials — everything in one place.
          </p>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-widest"
                style={{ color: 'rgba(26,26,26,0.45)' }}
              >
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="tu@correo.com"
                className="w-full px-4 py-3 rounded-xl text-sm text-[#1A1A1A] placeholder-[rgba(26,26,26,0.2)] outline-none transition-all duration-300 focus:ring-2"
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid rgba(26,26,26,0.08)',
                  '--tw-ring-color': 'rgba(131, 59, 14,0.5)',
                } as React.CSSProperties}
              />
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-2 uppercase tracking-widest"
                style={{ color: 'rgba(26,26,26,0.45)' }}
              >
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full px-4 py-3 rounded-xl text-sm text-[#1A1A1A] placeholder-[rgba(26,26,26,0.2)] outline-none transition-all duration-300 focus:ring-2"
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid rgba(26,26,26,0.08)',
                  '--tw-ring-color': 'rgba(131, 59, 14,0.5)',
                } as React.CSSProperties}
              />
            </div>

            {error && (
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm"
                style={{ backgroundColor: 'rgba(242,0,34,0.08)', border: '1px solid rgba(242,0,34,0.2)', color: '#F20022' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: '#833B0E',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(131, 59, 14,0.35)',
              }}
              onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLElement).style.backgroundColor = '#6B3009' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = '#833B0E' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3V0a12 12 0 00-12 12h4z"/>
                  </svg>
                  Entrando...
                </span>
              ) : 'Access your portal'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6" style={{ color: 'rgba(26,26,26,0.25)' }}>
          ¿Problemas para acceder?{' '}
          <a href="mailto:hola@nok.do" className="text-[#833B0E] hover:text-[#1A1A1A] transition-colors">
            Escríbenos
          </a>
        </p>

        <p className="text-center text-xs mt-2" style={{ color: 'rgba(26,26,26,0.15)', letterSpacing: '0.1em' }}>
          Curated stays designed to flow with you
        </p>
      </div>
    </div>
  )
}
