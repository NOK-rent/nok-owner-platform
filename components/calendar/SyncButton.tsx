'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SyncButton({ propertyId }: { propertyId: string }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function handleSync() {
    setState('loading')
    setMsg('')
    try {
      const res = await fetch(`/api/sync/guesty?propertyId=${propertyId}`, { method: 'POST' })
      const data = await res.json()
      const errors = data.synced?.errors?.length ? ` | Errores: ${data.synced.errors.join(', ')}` : ''
      setMsg((data.message ?? data.error ?? 'Sincronizado') + errors)
      setState('done')
      setTimeout(() => { router.refresh(); setState('idle') }, 1500)
    } catch {
      setMsg('Error al sincronizar')
      setState('error')
      setTimeout(() => setState('idle'), 3000)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span className="text-xs" style={{ color: state === 'error' ? '#F20022' : 'rgba(26,26,26,0.4)' }}>
          {msg}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={state === 'loading' || state === 'done'}
        className="text-sm px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-200 disabled:opacity-50 cursor-pointer"
        style={{
          color: '#833B0E',
          border: '1px solid rgba(131, 59, 14,0.3)',
          backgroundColor: 'rgba(131, 59, 14,0.08)',
        }}
      >
        <span className={state === 'loading' ? 'animate-spin inline-block' : ''}>↻</span>
        {state === 'loading' ? 'Sincronizando...' : 'Sincronizar con Guesty'}
      </button>
    </div>
  )
}
