'use client'

import { useState } from 'react'

interface Props {
  propertyId: string
}

export default function SupportForm({ propertyId }: Props) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success: boolean; area?: string } | null>(null)

  const handleSubmit = async () => {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/soporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, message }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult({ success: true, area: data.area })
        setMessage('')
        setTimeout(() => {
          setResult(null)
          setOpen(false)
        }, 4000)
      } else {
        setResult({ success: false })
      }
    } catch {
      setResult({ success: false })
    } finally {
      setSending(false)
    }
  }

  if (!open) {
    return (
      <div className="rounded-2xl p-6 nok-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'rgba(131, 59, 14,0.15)', border: '1px solid rgba(131, 59, 14,0.25)' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1A1A1A]">Preguntale al equipo</h3>
              <p className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>
                Consultas, solicitudes o dudas sobre tu propiedad
              </p>
            </div>
          </div>
          <button
            onClick={() => setOpen(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200"
            style={{
              backgroundColor: 'rgba(131, 59, 14,0.15)',
              color: '#833B0E',
              border: '1px solid rgba(131, 59, 14,0.25)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(131, 59, 14,0.25)'
              e.currentTarget.style.borderColor = 'rgba(131, 59, 14,0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(131, 59, 14,0.15)'
              e.currentTarget.style.borderColor = 'rgba(131, 59, 14,0.25)'
            }}
          >
            Escribir consulta
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-6 nok-card" style={{ border: '1px solid rgba(131, 59, 14,0.3)' }}>
      <div className="flex items-center gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: 'rgba(131, 59, 14,0.15)', border: '1px solid rgba(131, 59, 14,0.25)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#833B0E" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[#1A1A1A]">Preguntale al equipo</h3>
          <p className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>
            Tu consulta sera asignada automaticamente al area responsable
          </p>
        </div>
      </div>

      {result?.success ? (
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ backgroundColor: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0E6845" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <div>
            <p className="text-sm font-medium text-[#0E6845]">Consulta enviada</p>
            <p className="text-xs" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Asignada a {result.area} — te responderemos pronto
            </p>
          </div>
        </div>
      ) : result?.success === false ? (
        <div
          className="flex items-center gap-3 p-4 rounded-xl mb-4"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}
        >
          <p className="text-sm text-[#F20022]">Error al enviar. Intenta de nuevo.</p>
        </div>
      ) : null}

      {!result?.success && (
        <>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Escribe tu consulta aqui... Ejemplo: Quiero bloquear fechas del 15 al 20 de diciembre para uso personal."
            rows={4}
            className="w-full rounded-xl px-4 py-3 text-sm text-[#1A1A1A] placeholder:text-[#1A1A1A]/25 resize-none focus:outline-none focus:ring-1 focus:ring-[#833B0E]/50"
            style={{
              backgroundColor: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(26,26,26,0.08)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-[10px]" style={{ color: 'rgba(26,26,26,0.2)' }}>
              Cmd+Enter para enviar
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setOpen(false); setMessage(''); setResult(null) }}
                className="px-4 py-2 rounded-lg text-sm transition-colors"
                style={{ color: 'rgba(26,26,26,0.4)' }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={sending || !message.trim()}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 disabled:opacity-40"
                style={{ backgroundColor: '#833B0E' }}
              >
                {sending ? 'Enviando...' : 'Enviar consulta'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
