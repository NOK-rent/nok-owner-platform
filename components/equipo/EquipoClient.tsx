'use client'

/**
 * Pestaña "Equipo NOK" — historial completo de conversaciones con el equipo
 * (tickets de soporte, hilo tipo chat con adjuntos) + comunicados de NOK.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface PropertyLite { id: string; name: string }
interface Ticket {
  id: string
  title: string
  status: string
  area_responsable: string | null
  apartamento: string | null
  property_id: string | null
  urgencia: string | null
  created_at: string
  updated_at: string
  last_owner_message_at: string | null
  last_team_message_at: string | null
}
interface Attachment { name: string; url: string; type: string; size: number }
interface TicketEvent {
  id: string
  event_type: string
  content: string
  metadata: { attachments?: Attachment[] } | null
  author_name: string | null
  created_at: string
}
interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link_url: string | null
  link_label: string | null
  attachments?: Attachment[] | null
  is_read: boolean
  created_at: string
}

interface WorkItem {
  id: string
  tipo: 'inspeccion' | 'incidencia'
  titulo: string
  descripcion: string | null
  valor_usd: number | null
  pdf_url: string | null
  fotos: Attachment[] | null
  status: 'enviada' | 'aceptada' | 'programada' | 'completada'
  fecha_programada: string | null
  created_at: string
  properties: { name: string } | null
}

interface Props {
  ownerName: string
  properties: PropertyLite[]
  initialTickets: Ticket[]
  notifications: Notification[]
  initialWorkItems?: WorkItem[]
}

const WORK_STATUS: Record<string, { es: string; en: string; bg: string; color: string }> = {
  enviada: { es: 'Pendiente de tu aprobación', en: 'Waiting for your approval', bg: 'rgba(214,167,0,0.14)', color: '#8A6D00' },
  aceptada: { es: 'Aceptada — NOK programará la fecha', en: 'Accepted — NOK will schedule it', bg: 'rgba(0,128,198,0.12)', color: '#0080C6' },
  programada: { es: 'Programada', en: 'Scheduled', bg: 'rgba(0,128,198,0.12)', color: '#0080C6' },
  completada: { es: 'Realizada ✓', en: 'Completed ✓', bg: 'rgba(14,104,69,0.12)', color: '#0E6845' },
}

const STATUS_LABELS: Record<string, { label: string; bg: string; color: string }> = {
  open: { label: 'En revisión', bg: 'rgba(214,167,0,0.14)', color: '#8A6D00' },
  in_progress: { label: 'En progreso', bg: 'rgba(0,128,198,0.12)', color: '#0080C6' },
  awaiting_owner: { label: 'NOK respondió', bg: 'rgba(14,104,69,0.12)', color: '#0E6845' },
  resolved: { label: 'Resuelta', bg: 'rgba(26,26,26,0.06)', color: 'rgba(26,26,26,0.5)' },
  closed: { label: 'Cerrada', bg: 'rgba(26,26,26,0.06)', color: 'rgba(26,26,26,0.5)' },
}

const NOTIF_COLORS: Record<string, string> = {
  info: '#0080C6',
  success: '#0E6845',
  warning: '#D6A700',
  payment: '#0E6845',
  urgent: '#F20022',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function ClipIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function AttachmentChips({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {attachments.map((a, i) => (
        <a
          key={i}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
          style={{ backgroundColor: 'rgba(26,26,26,0.05)', color: '#833B0E', border: '1px solid rgba(26,26,26,0.08)' }}
        >
          <ClipIcon />
          <span className="max-w-[180px] truncate">{a.name}</span>
        </a>
      ))}
    </div>
  )
}

export default function EquipoClient({ ownerName, properties, initialTickets, notifications, initialWorkItems = [] }: Props) {
  const [tab, setTab] = useState<'conversaciones' | 'comunicados' | 'inspecciones'>('conversaciones')
  const [workItems, setWorkItems] = useState<WorkItem[]>(initialWorkItems)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const locale = typeof document !== 'undefined' && document.cookie.includes('nok_locale=en') ? 'en' : 'es'

  async function aceptarInspeccion(id: string) {
    if (acceptingId) return
    setAcceptingId(id)
    try {
      const res = await fetch(`/api/inspecciones/${id}/aceptar`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      setWorkItems(prev => prev.map(w => w.id === id ? { ...w, status: 'aceptada' } : w))
    } catch (e: any) {
      alert(e.message || 'No se pudo aceptar')
    } finally {
      setAcceptingId(null)
    }
  }
  const [tickets, setTickets] = useState<Ticket[]>(initialTickets)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [events, setEvents] = useState<TicketEvent[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [showNew, setShowNew] = useState(initialTickets.length === 0)

  // Composer state (compartido nuevo/respuesta)
  const [message, setMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [newPropertyId, setNewPropertyId] = useState(properties[0]?.id ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)

  const activeTicket = tickets.find(t => t.id === activeId) ?? null

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true)
    try {
      const res = await fetch(`/api/soporte/tickets/${id}`)
      const data = await res.json()
      if (res.ok) setEvents(data.events ?? [])
    } finally {
      setLoadingThread(false)
    }
  }, [])

  useEffect(() => {
    if (activeId) loadThread(activeId)
  }, [activeId, loadThread])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  async function refreshTickets() {
    const res = await fetch('/api/soporte/tickets')
    const data = await res.json()
    if (res.ok) setTickets(data.tickets ?? [])
  }

  function resetComposer() {
    setMessage('')
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function submitNew() {
    if (!message.trim() || !newPropertyId || sending) return
    setSending(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('propertyId', newPropertyId)
      fd.set('message', message.trim())
      files.forEach(f => fd.append('files', f))
      const res = await fetch('/api/soporte/tickets', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      resetComposer()
      setShowNew(false)
      await refreshTickets()
      setActiveId(data.ticketId)
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la consulta')
    } finally {
      setSending(false)
    }
  }

  async function submitReply() {
    if ((!message.trim() && !files.length) || !activeId || sending) return
    setSending(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('message', message.trim())
      files.forEach(f => fd.append('files', f))
      const res = await fetch(`/api/soporte/tickets/${activeId}/reply`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error')
      resetComposer()
      await Promise.all([loadThread(activeId), refreshTickets()])
    } catch (e: any) {
      setError(e.message || 'No se pudo enviar la respuesta')
    } finally {
      setSending(false)
    }
  }

  function onPickFiles(list: FileList | null) {
    if (!list) return
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, 5))
  }

  const unreadComunicados = notifications.filter(n => !n.is_read).length

  return (
    <div className="px-6 lg:px-16 py-10" style={{ backgroundColor: '#F0EFED', minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="font-serif text-4xl font-light text-[#1A1A1A]">Equipo NOK</h1>
          <p className="text-sm mt-2" style={{ color: 'rgba(26,26,26,0.45)' }}>
            Escríbenos lo que necesites, {ownerName.split(' ')[0]}. Todo tu historial con el equipo vive aquí.
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setActiveId(null); resetComposer(); setTab('conversaciones') }}
          className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all"
          style={{ backgroundColor: '#833B0E', color: '#FFFFFF' }}
        >
          + Nueva consulta
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {([
          ['conversaciones', locale === 'en' ? 'Conversations' : 'Conversaciones'],
          ['comunicados', `${locale === 'en' ? 'NOK updates' : 'Comunicados de NOK'}${unreadComunicados ? ` (${unreadComunicados})` : ''}`],
          ['inspecciones', `${locale === 'en' ? 'Inspections & repairs' : 'Inspecciones y arreglos'}${workItems.some(w => w.status === 'enviada' && w.tipo === 'inspeccion') ? ' ●' : ''}`],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all"
            style={{
              backgroundColor: tab === key ? 'rgba(131,59,14,0.15)' : 'transparent',
              color: tab === key ? '#833B0E' : 'rgba(26,26,26,0.45)',
              border: `1px solid ${tab === key ? 'rgba(131,59,14,0.35)' : 'rgba(26,26,26,0.08)'}`,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'inspecciones' ? (
        /* ── Inspecciones y arreglos ── */
        <div className="max-w-3xl space-y-3">
          {workItems.length === 0 && (
            <div className="rounded-2xl p-8 nok-card text-center text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>
              {locale === 'en' ? 'No inspections or repairs yet.' : 'Aún no hay inspecciones ni arreglos.'}
            </div>
          )}
          {workItems.map(w => {
            const st = WORK_STATUS[w.status] ?? WORK_STATUS.enviada
            return (
              <div key={w.id} className="rounded-2xl p-5 nok-card">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{w.tipo === 'inspeccion' ? '🔧' : '⚠️'}</span>
                  <p className="text-sm font-semibold text-[#1A1A1A]">{w.titulo}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: st.bg, color: st.color }}>
                    {locale === 'en' ? st.en : st.es}
                  </span>
                  <span className="ml-auto text-[11px]" style={{ color: 'rgba(26,26,26,0.35)' }}>{fmtDate(w.created_at)}</span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                  {w.properties?.name ?? ''}
                  {w.valor_usd != null ? ` · USD ${Number(w.valor_usd).toFixed(2)}` : ''}
                  {w.fecha_programada ? ` · ${locale === 'en' ? 'scheduled for' : 'programada para el'} ${w.fecha_programada}` : ''}
                </p>
                {w.descripcion && <p className="text-sm mt-2 whitespace-pre-wrap" style={{ color: 'rgba(26,26,26,0.6)' }}>{w.descripcion}</p>}
                {w.pdf_url && (
                  <a href={w.pdf_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                    style={{ backgroundColor: 'rgba(26,26,26,0.05)', color: '#833B0E', border: '1px solid rgba(26,26,26,0.08)' }}>
                    <ClipIcon /> {locale === 'en' ? 'Inspection document (PDF)' : 'Documento de inspección (PDF)'}
                  </a>
                )}
                {(w.fotos ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(w.fotos ?? []).map((f, i) => (
                      <a key={i} href={f.url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={f.name} className="w-24 h-20 object-cover rounded-lg" style={{ border: '1px solid rgba(26,26,26,0.08)' }} />
                      </a>
                    ))}
                  </div>
                )}
                {w.tipo === 'inspeccion' && w.status === 'enviada' && (
                  <button
                    onClick={() => aceptarInspeccion(w.id)}
                    disabled={acceptingId === w.id}
                    className="mt-3 px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all disabled:opacity-60"
                    style={{ backgroundColor: '#0E6845', color: '#FFFFFF' }}
                  >
                    {acceptingId === w.id
                      ? (locale === 'en' ? 'Accepting…' : 'Aceptando…')
                      : (locale === 'en' ? '✓ Yes, accept the maintenance' : '✓ Sí, acepto el mantenimiento')}
                  </button>
                )}
                {w.tipo === 'inspeccion' && w.status === 'enviada' && (
                  <p className="text-[11px] mt-2" style={{ color: 'rgba(26,26,26,0.35)' }}>
                    {locale === 'en'
                      ? 'Questions? Write to us in the Conversations tab or reply to the email.'
                      : '¿Dudas? Escríbenos en la pestaña Conversaciones o responde el correo.'}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : tab === 'comunicados' ? (
        /* ── Comunicados ── */
        <div className="max-w-3xl space-y-3">
          {notifications.length === 0 && (
            <div className="rounded-2xl p-8 nok-card text-center text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>
              Aún no tienes comunicados de NOK.
            </div>
          )}
          {notifications.map(n => (
            <div key={n.id} className="rounded-2xl p-5 nok-card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ backgroundColor: NOTIF_COLORS[n.type] ?? '#0080C6' }} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#1A1A1A]">{n.title}</p>
                    {n.body && <p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: 'rgba(26,26,26,0.6)' }}>{n.body}</p>}
                    <AttachmentChips attachments={n.attachments ?? undefined} />
                    {n.link_url && !(n.attachments?.length && n.link_url === n.attachments[0]?.url) && (
                      <a href={n.link_url} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-medium mt-2" style={{ color: '#833B0E' }}>
                        {n.link_label || 'Ver más'} →
                      </a>
                    )}
                  </div>
                </div>
                <span className="text-[11px] shrink-0" style={{ color: 'rgba(26,26,26,0.35)' }}>{fmtDate(n.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Conversaciones ── */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ minHeight: '60vh' }}>
          {/* Lista */}
          <div className="space-y-2">
            {tickets.length === 0 && !showNew && (
              <div className="rounded-2xl p-8 nok-card text-center text-sm" style={{ color: 'rgba(26,26,26,0.4)' }}>
                Aún no has escrito al equipo.
              </div>
            )}
            {tickets.map(t => {
              const st = STATUS_LABELS[t.status] ?? STATUS_LABELS.open
              const active = t.id === activeId
              return (
                <button
                  key={t.id}
                  onClick={() => { setActiveId(t.id); setShowNew(false); resetComposer(); setError(null) }}
                  className="w-full text-left rounded-2xl p-4 cursor-pointer transition-all duration-200"
                  style={{
                    backgroundColor: '#FFFFFF',
                    border: `1px solid ${active ? '#833B0E' : 'rgba(26,26,26,0.08)'}`,
                    boxShadow: active ? '0 8px 24px rgba(131,59,14,0.12)' : 'none',
                  }}
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                    <span className="text-[11px]" style={{ color: 'rgba(26,26,26,0.35)' }}>{fmtDate(t.updated_at)}</span>
                  </div>
                  <p className="text-sm font-medium text-[#1A1A1A] truncate">{t.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                    {t.apartamento || 'General'}{t.area_responsable ? ` · ${t.area_responsable}` : ''}
                  </p>
                </button>
              )
            })}
          </div>

          {/* Panel derecho: nueva consulta o hilo */}
          <div className="lg:col-span-2">
            {showNew ? (
              <div className="rounded-2xl p-6 nok-card">
                <p className="text-xs uppercase tracking-widest mb-4" style={{ color: '#833B0E' }}>Nueva consulta</p>
                <label className="block text-xs mb-1.5" style={{ color: 'rgba(26,26,26,0.45)' }}>Apartamento</label>
                <select
                  value={newPropertyId}
                  onChange={e => setNewPropertyId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none cursor-pointer mb-4"
                  style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.12)', color: '#1A1A1A' }}
                >
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label className="block text-xs mb-1.5" style={{ color: 'rgba(26,26,26,0.45)' }}>¿En qué te ayudamos?</label>
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={5}
                  placeholder="Cuéntanos tu duda o solicitud…"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                  style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.12)', color: '#1A1A1A' }}
                />
                <ComposerFooter
                  files={files}
                  setFiles={setFiles}
                  fileInputRef={fileInputRef}
                  onPickFiles={onPickFiles}
                  sending={sending}
                  submitLabel="Enviar consulta"
                  onSubmit={submitNew}
                  error={error}
                />
                <p className="text-[11px] mt-3" style={{ color: 'rgba(26,26,26,0.35)' }}>
                  Tu consulta llega directo al equipo NOK (owners@nok.rent) y la respuesta aparecerá aquí y en tu correo.
                </p>
              </div>
            ) : activeTicket ? (
              <div className="rounded-2xl nok-card flex flex-col" style={{ maxHeight: '75vh' }}>
                {/* Thread header */}
                <div className="px-6 py-4" style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}>
                  <p className="text-sm font-semibold text-[#1A1A1A]">{activeTicket.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                    {activeTicket.apartamento || 'General'} · {STATUS_LABELS[activeTicket.status]?.label ?? activeTicket.status} · abierta el {fmtDate(activeTicket.created_at)}
                  </p>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  {loadingThread && <p className="text-sm text-center" style={{ color: 'rgba(26,26,26,0.35)' }}>Cargando conversación…</p>}
                  {!loadingThread && events.map(ev => {
                    const mine = ev.event_type === 'owner_message'
                    return (
                      <div key={ev.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[85%] rounded-2xl px-4 py-3"
                          style={mine
                            ? { backgroundColor: 'rgba(131,59,14,0.1)', border: '1px solid rgba(131,59,14,0.15)' }
                            : { backgroundColor: '#F0EFED', border: '1px solid rgba(26,26,26,0.05)' }}
                        >
                          <p className="text-[11px] font-medium mb-1" style={{ color: mine ? '#833B0E' : '#0E6845' }}>
                            {mine ? 'Tú' : `Equipo NOK${ev.author_name && ev.author_name !== 'system' && ev.author_name !== 'Equipo NOK' ? ` · ${ev.author_name}` : ''}`}
                          </p>
                          <p className="text-sm whitespace-pre-wrap text-[#1A1A1A]">{ev.content}</p>
                          <AttachmentChips attachments={ev.metadata?.attachments} />
                          <p className="text-[10px] mt-1.5" style={{ color: 'rgba(26,26,26,0.3)' }}>{fmtDateTime(ev.created_at)}</p>
                        </div>
                      </div>
                    )
                  })}
                  <div ref={threadEndRef} />
                </div>

                {/* Reply composer */}
                <div className="px-6 py-4" style={{ borderTop: '1px solid rgba(26,26,26,0.06)' }}>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={2}
                    placeholder="Escribe tu respuesta…"
                    className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-none"
                    style={{ backgroundColor: '#FFFFFF', border: '1px solid rgba(26,26,26,0.12)', color: '#1A1A1A' }}
                  />
                  <ComposerFooter
                    files={files}
                    setFiles={setFiles}
                    fileInputRef={fileInputRef}
                    onPickFiles={onPickFiles}
                    sending={sending}
                    submitLabel="Enviar"
                    onSubmit={submitReply}
                    error={error}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-10 nok-card flex items-center justify-center text-sm" style={{ color: 'rgba(26,26,26,0.4)', minHeight: '300px' }}>
                Selecciona una conversación o crea una nueva consulta.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ComposerFooter({ files, setFiles, fileInputRef, onPickFiles, sending, submitLabel, onSubmit, error }: {
  files: File[]
  setFiles: (f: File[]) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onPickFiles: (list: FileList | null) => void
  sending: boolean
  submitLabel: string
  onSubmit: () => void
  error: string | null
}) {
  return (
    <div className="mt-2">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ backgroundColor: 'rgba(26,26,26,0.05)', color: '#1A1A1A' }}>
              <ClipIcon />
              <span className="max-w-[160px] truncate">{f.name}</span>
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="cursor-pointer font-bold" style={{ color: 'rgba(26,26,26,0.4)' }}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="application/pdf,image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={e => onPickFiles(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer"
            style={{ color: 'rgba(26,26,26,0.5)', border: '1px solid rgba(26,26,26,0.1)' }}
          >
            <ClipIcon /> Adjuntar PDF o foto
          </button>
          {error && <span className="text-xs" style={{ color: '#F20022' }}>{error}</span>}
        </div>
        <button
          onClick={onSubmit}
          disabled={sending}
          className="px-5 py-2 rounded-lg text-sm font-medium cursor-pointer transition-all disabled:opacity-60"
          style={{ backgroundColor: '#833B0E', color: '#FFFFFF' }}
        >
          {sending ? 'Enviando…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
