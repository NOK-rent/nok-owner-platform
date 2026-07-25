'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createClient = () => createBrowserClient<any>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
import Link from 'next/link'

type Session = {
  owner_name: string
  owner_email: string
  property_address: string
  property_city: string
  quote_total: number | null
  quote_currency: string | null
  quote_pdf_url: string | null
  status: string
}

function formatCurrency(amount: number, currency: string): string {
  if (currency === 'DOP') return `RD$${amount.toLocaleString()}`
  if (currency === 'COP') return `$${amount.toLocaleString()}`
  return `$${amount.toFixed(0)}`
}

export default function QuotePage() {
  const params = useParams()
  const sessionId = params.sessionId as string
  const supabase = createClient()

  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('onboarding_sessions')
        .select('owner_name, owner_email, property_address, property_city, quote_total, quote_currency, quote_pdf_url, status')
        .eq('id', sessionId)
        .single()
      setSession(data as Session)
      setLoading(false)
    }
    load()
  }, [sessionId, supabase])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F0EFED] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-100 bg-white px-6 py-4">
        <span className="text-xl font-bold tracking-widest">NOK</span>
      </div>

      <div className="max-w-lg mx-auto px-6 py-16 text-center">
        {/* Success icon */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-3">¡Listo, {session.owner_name.split(' ')[0]}!</h1>
        <p className="text-gray-500 mb-8 text-lg">
          Tu cotización está lista. La hemos enviado a <strong>{session.owner_email}</strong>.
        </p>

        {/* Quote summary card */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-8 text-left">
          <div className="flex justify-between items-center mb-4 pb-4 border-b border-gray-100">
            <div>
              <p className="text-sm text-gray-500">Propiedad</p>
              <p className="font-semibold text-gray-900">{session.property_address}</p>
              <p className="text-sm text-gray-400">{session.property_city}</p>
            </div>
            {session.quote_total && session.quote_currency && (
              <div className="text-right">
                <p className="text-sm text-gray-500">Total inversión</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatCurrency(session.quote_total, session.quote_currency)}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {[
              { icon: '📄', text: 'Cotización PDF enviada a tu email' },
              { icon: '📞', text: 'Un ejecutivo NOK te contactará en 24 horas' },
              { icon: '✍️', text: 'Firmas el contrato de gestión' },
              { icon: '🛍️', text: 'NOK coordina compras e instalación' },
              { icon: '📸', text: 'Fotografía profesional incluida' },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-lg">{step.icon}</span>
                <span className="text-sm text-gray-600">{step.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {session.quote_pdf_url && (
            <a
              href={session.quote_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full bg-gray-900 text-white py-4 rounded-xl font-semibold text-sm hover:bg-gray-700 transition-colors"
            >
              Descargar cotización PDF →
            </a>
          )}
          <Link
            href="/onboarding"
            className="block w-full border border-gray-200 text-gray-600 py-4 rounded-xl font-semibold text-sm hover:border-gray-400 transition-colors"
          >
            Registrar otro apartamento
          </Link>
        </div>

        <p className="text-xs text-gray-400 mt-8">
          ¿Tienes preguntas? Escríbenos a{' '}
          <a href="mailto:hola@nok.do" className="underline">hola@nok.do</a>
        </p>
      </div>
    </div>
  )
}
