'use client'

/**
 * Prompt de instalación de la PWA.
 * - Android/Chrome: captura beforeinstallprompt → botón "Instalar app".
 * - iOS/Safari: no hay API; muestra instrucción "Compartir → Añadir a inicio".
 * Se oculta si ya está instalada (standalone) o si el owner lo descarta.
 */

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'nok_install_dismissed'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Ya instalada → no mostrar
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
    if (standalone) return
    if (localStorage.getItem(DISMISS_KEY)) return

    const ua = window.navigator.userAgent
    const ios = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream
    setIsIOS(ios)

    const onBIP = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', onBIP)

    // iOS no dispara beforeinstallprompt: mostrar la instrucción tras un momento
    if (ios) {
      const t = setTimeout(() => setShow(true), 2500)
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', onBIP) }
    }
    return () => window.removeEventListener('beforeinstallprompt', onBIP)
  }, [])

  function dismiss() {
    setShow(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* noop */ }
  }

  async function install() {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
    dismiss()
  }

  if (!show) return null

  return (
    <div
      className="fixed left-3 right-3 z-[60] rounded-2xl p-4 flex items-center gap-3"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        backgroundColor: '#1A1A1A',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="NOK" width={40} height={40} style={{ borderRadius: 10, flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white leading-tight">Instala NOK en tu teléfono</p>
        {isIOS ? (
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Toca <b>Compartir</b> ⬆️ y luego <b>Añadir a pantalla de inicio</b>.
          </p>
        ) : (
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Ábrela como app, a pantalla completa y con un toque.
          </p>
        )}
      </div>
      {!isIOS && deferred && (
        <button
          onClick={install}
          className="px-4 py-2 rounded-lg text-sm font-medium shrink-0"
          style={{ backgroundColor: '#D6A700', color: '#1A1A1A' }}
        >
          Instalar
        </button>
      )}
      <button onClick={dismiss} aria-label="Cerrar" className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full" style={{ color: 'rgba(255,255,255,0.5)' }}>
        ✕
      </button>
    </div>
  )
}
