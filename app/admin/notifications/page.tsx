'use client'

import { useEffect, useState } from 'react'

type Property = { id: string; name: string; active: boolean }
type Owner = { id: string; name: string; email: string; properties: Property[] }

const TYPES = [
  { value: 'info', label: 'ℹ️ Informativo' },
  { value: 'success', label: '✅ Positivo' },
  { value: 'warning', label: '⚠️ Aviso' },
  { value: 'payment', label: '💳 Pago / cobro' },
  { value: 'urgent', label: '🚨 Urgente' },
]

export default function AdminNotificationsPage() {
  const [owners, setOwners] = useState<Owner[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [broadcast, setBroadcast] = useState(false)
  const [ownerId, setOwnerId] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [type, setType] = useState('info')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/notifications')
      .then(async (r) => {
        if (r.status === 403 || r.status === 401) { setForbidden(true); return { owners: [] } }
        return r.json()
      })
      .then((d) => setOwners(d.owners ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const selectedOwner = owners.find((o) => o.id === ownerId)

  async function send(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          broadcast,
          ownerId: broadcast ? undefined : ownerId,
          propertyId: broadcast ? undefined : propertyId || undefined,
          type, title, body,
          link_url: linkUrl || undefined,
          link_label: linkLabel || undefined,
        }),
      })
      const d = await res.json()
      if (!res.ok) { setResult({ ok: false, msg: d.error || 'Error al enviar' }); return }
      setResult({ ok: true, msg: `Comunicado enviado a ${d.sent} propietario(s).` })
      setTitle(''); setBody(''); setLinkUrl(''); setLinkLabel('')
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Error de red' })
    } finally {
      setSending(false)
    }
  }

  const canSend = title.trim() && body.trim() && (broadcast || ownerId)

  if (loading) return <div className="p-10 text-sm" style={{ color: 'rgba(242,242,242,0.6)' }}>Cargando…</div>
  if (forbidden) return <div className="p-10 text-sm" style={{ color: '#F87171' }}>Acceso solo para administradores NOK.</div>

  const inputStyle = { backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: '#F2F2F2' }

  return (
    <div className="min-h-screen p-8 lg:p-16" style={{ backgroundColor: '#1A1A1A' }}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1" style={{ color: '#F2F2F2' }}>Comunicados a propietarios</h1>
        <p className="text-sm mb-8" style={{ color: 'rgba(242,242,242,0.5)' }}>
          El mensaje aparece como notificación en el portal del propietario (overview).
        </p>

        <form onSubmit={send} className="space-y-5">
          {/* Broadcast toggle */}
          <label className="flex items-center gap-3 text-sm cursor-pointer" style={{ color: '#F2F2F2' }}>
            <input type="checkbox" checked={broadcast} onChange={(e) => setBroadcast(e.target.checked)} />
            Enviar a <strong>todos</strong> los propietarios (broadcast)
          </label>

          {!broadcast && (
            <>
              <div>
                <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Propietario</label>
                <select value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPropertyId('') }}
                  className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} required={!broadcast}>
                  <option value="">— Seleccionar —</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>{o.name} ({o.email})</option>
                  ))}
                </select>
              </div>

              {selectedOwner && selectedOwner.properties?.length > 0 && (
                <div>
                  <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>
                    Propiedad (opcional — vacío = todas)
                  </label>
                  <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
                    <option value="">Todas las propiedades del propietario</option>
                    {selectedOwner.properties.filter((p) => p.active).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <div>
            <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Tipo</label>
            <select value={type} onChange={(e) => setType(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Título</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120}
              placeholder="Ej: Pago de servicios atrasado"
              className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} required />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Mensaje</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
              placeholder="Ej: Tu pago de servicios de mayo está pendiente. Por favor regulariza antes del 30."
              className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Link (opcional)</label>
              <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…"
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-widest mb-2" style={{ color: 'rgba(242,242,242,0.4)' }}>Texto del link</label>
              <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Ver detalle"
                className="w-full rounded-lg px-3 py-2 text-sm" style={inputStyle} />
            </div>
          </div>

          <button type="submit" disabled={!canSend || sending}
            className="rounded-lg px-6 py-2.5 text-sm font-semibold disabled:opacity-40"
            style={{ backgroundColor: '#E0732C', color: '#fff' }}>
            {sending ? 'Enviando…' : broadcast ? 'Enviar a todos' : 'Enviar comunicado'}
          </button>

          {result && (
            <p className="text-sm" style={{ color: result.ok ? '#4ADE80' : '#F87171' }}>{result.msg}</p>
          )}
        </form>
      </div>
    </div>
  )
}
