'use client'

import { useEffect, useState } from 'react'

type Notification = {
  id: string
  type: 'info' | 'success' | 'warning' | 'payment' | 'urgent'
  title: string
  body: string
  link_url: string | null
  link_label: string | null
}

const STYLES: Record<Notification['type'], { border: string; bg: string; accent: string; icon: string }> = {
  info:    { border: 'rgba(96,165,250,0.5)',  bg: 'rgba(96,165,250,0.08)',  accent: '#0080C6', icon: 'ℹ️' },
  success: { border: 'rgba(74,222,128,0.5)',  bg: 'rgba(74,222,128,0.08)',  accent: '#0E6845', icon: '✅' },
  warning: { border: 'rgba(251,191,36,0.55)', bg: 'rgba(251,191,36,0.09)',  accent: '#D6A700', icon: '⚠️' },
  payment: { border: 'rgba(248,113,113,0.55)',bg: 'rgba(248,113,113,0.09)', accent: '#F20022', icon: '💳' },
  urgent:  { border: 'rgba(248,113,113,0.7)', bg: 'rgba(248,113,113,0.12)', accent: '#F20022', icon: '🚨' },
}

export default function NotificationsBanner({ propertyId }: { propertyId: string }) {
  const [items, setItems] = useState<Notification[]>([])
  const [dismissing, setDismissing] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/notifications?propertyId=${propertyId}&unread=1`)
      .then((r) => (r.ok ? r.json() : { notifications: [] }))
      .then((d) => { if (active) setItems(d.notifications ?? []) })
      .catch(() => {})
    return () => { active = false }
  }, [propertyId])

  async function dismiss(id: string) {
    setDismissing(id)
    setItems((prev) => prev.filter((n) => n.id !== id))
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
    } catch { /* optimistic — already removed from UI */ }
    setDismissing(null)
  }

  if (!items.length) return null

  return (
    <div className="space-y-3">
      {items.map((n) => {
        const s = STYLES[n.type] ?? STYLES.info
        return (
          <div
            key={n.id}
            className="rounded-2xl p-5 flex items-start gap-4"
            style={{ border: `1px solid ${s.border}`, backgroundColor: s.bg }}
          >
            <span className="text-xl leading-none mt-0.5">{s.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: s.accent }}>{n.title}</p>
              <p className="text-sm mt-1 whitespace-pre-line" style={{ color: 'rgba(26,26,26,0.85)' }}>{n.body}</p>
              {n.link_url && (
                <a
                  href={n.link_url}
                  className="inline-block mt-2 text-xs font-semibold underline"
                  style={{ color: s.accent }}
                >
                  {n.link_label || 'Ver más'} →
                </a>
              )}
            </div>
            <button
              onClick={() => dismiss(n.id)}
              disabled={dismissing === n.id}
              aria-label="Marcar como leída"
              className="text-lg leading-none px-1 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: 'rgba(26,26,26,0.8)' }}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
