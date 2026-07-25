'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Owner, Property } from '@/lib/types/database'

interface GroupLite { id: string; name: string; owner_id: string; active: boolean }

interface TopNavProps {
  owner: Owner
  properties: Property[]
  groups?: GroupLite[]
}

type Locale = 'es' | 'en'

const NAV_LABELS: Record<Locale, Record<string, string>> = {
  es: {
    resumen: 'Resumen', calendario: 'Calendario', reservas: 'Reservas', resenas: 'Reseñas',
    strategy: 'Strategy', calculos: 'Cálculos', analiticas: 'Analíticas', equipo: 'Equipo NOK',
    cerrarSesion: 'Cerrar sesión',
  },
  en: {
    resumen: 'Overview', calendario: 'Calendar', reservas: 'Reservations', resenas: 'Reviews',
    strategy: 'Strategy', calculos: 'My numbers', analiticas: 'Analytics', equipo: 'NOK Team',
    cerrarSesion: 'Sign out',
  },
}

function readLocaleCookie(): Locale {
  if (typeof document === 'undefined') return 'es'
  return document.cookie.includes('nok_locale=en') ? 'en' : 'es'
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

export default function TopNav({ owner, properties, groups = [] }: TopNavProps) {
  const pathname  = usePathname()
  const router    = useRouter()
  const supabase  = createClient()

  const [showPropMenu, setShowPropMenu] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [locale, setLocale] = useState<Locale>('es')
  useEffect(() => { setLocale(readLocaleCookie()) }, [])
  const L = NAV_LABELS[locale]

  async function switchLocale(next: Locale) {
    if (next === locale) return
    setLocale(next)
    document.cookie = `nok_locale=${next};path=/;max-age=31536000;samesite=lax`
    try { await fetch('/api/owner/locale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) }) } catch { /* cookie ya quedó */ }
    router.refresh()
  }
  const propRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)

  // Extract active propertyId or groupId from URL
  const groupMatch = pathname.match(/\/dashboard\/group\/([^\/]+)/)
  const activeGroupId = groupMatch?.[1]
  const activeGroup = groups.find(g => g.id === activeGroupId)
  const match = pathname.match(/\/dashboard\/([^\/]+)/)
  const rawId = match?.[1]
  const reserved = ['analytics', 'group', 'equipo']
  const activePropertyId = !activeGroupId
    ? (rawId && !reserved.includes(rawId) ? rawId : properties[0]?.id)
    : undefined
  const activeProperty   = properties.find(p => p.id === activePropertyId) ?? properties[0]
  const activeLabel = activeGroup ? `▦ ${activeGroup.name}` : (activeProperty?.name ?? '—')

  const navLinks = activeGroupId ? [
    { label: L.resumen,    href: `/dashboard/group/${activeGroupId}/overview` },
    { label: L.reservas,   href: `/dashboard/group/${activeGroupId}/reservations` },
    { label: L.resenas,    href: `/dashboard/group/${activeGroupId}/reviews` },
    { label: 'NOK AI',     href: `/dashboard/group/${activeGroupId}/chat`, ai: true },
  ] : activePropertyId ? [
    { label: L.resumen,    href: `/dashboard/${activePropertyId}/overview` },
    { label: L.calendario, href: `/dashboard/${activePropertyId}/calendar` },
    { label: L.reservas,   href: `/dashboard/${activePropertyId}/reservations` },
    { label: L.resenas,    href: `/dashboard/${activePropertyId}/reviews` },
    { label: L.strategy,   href: `/dashboard/${activePropertyId}/revenue` },
    { label: L.calculos,   href: `/dashboard/${activePropertyId}/calculos` },
    { label: 'NOK AI',     href: `/dashboard/${activePropertyId}/chat`, ai: true },
  ] : []
  // Always-visible links
  const analyticsLink = { label: L.analiticas, href: '/dashboard/analytics' }
  const equipoLink = { label: L.equipo, href: '/dashboard/equipo' }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // Close dropdowns on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (propRef.current && !propRef.current.contains(e.target as Node)) setShowPropMenu(false)
      if (userRef.current && !userRef.current.contains(e.target as Node)) setShowUserMenu(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center h-16 px-6 lg:px-10 gap-6"
      style={{
        backgroundColor: 'rgba(240, 239, 237, 0.9)',
        borderBottom: '1px solid rgba(26, 26, 26, 0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      {/* ── Left: logo + property selector ── */}
      <div className="flex items-center gap-5 shrink-0">
        <Link
          href="/dashboard"
          className="font-serif text-2xl font-light tracking-[0.25em] text-[#1A1A1A] hover:text-[#833B0E] transition-colors duration-300"
        >
          NOK
        </Link>

        {/* Divider */}
        <div className="h-5 w-px" style={{ backgroundColor: 'rgba(26,26,26,0.1)' }} />

        {/* Property selector */}
        {(properties.length > 1 || groups.length > 0) ? (
          <div className="relative" ref={propRef}>
            <button
              onClick={() => setShowPropMenu(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all duration-200 cursor-pointer"
              style={{
                color: 'rgba(26,26,26,0.55)',
                border: '1px solid rgba(26,26,26,0.08)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#1A1A1A'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.55)'}
            >
              <span className="max-w-[160px] truncate">{activeLabel}</span>
              <ChevronDown />
            </button>

            {showPropMenu && (
              <div
                className="absolute top-full left-0 mt-2 rounded-xl z-50 min-w-52"
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid rgba(26,26,26,0.08)',
                  boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
                  maxHeight: '70vh',
                  overflowY: 'auto',
                }}
              >
                {groups.length > 0 && (
                  <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.35)' }}>Grupos</div>
                )}
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => { router.push(`/dashboard/group/${g.id}/overview`); setShowPropMenu(false) }}
                    className="w-full text-left px-4 py-3 transition-colors duration-150 cursor-pointer"
                    style={{
                      borderBottom: '1px solid rgba(26,26,26,0.05)',
                      backgroundColor: g.id === activeGroupId ? 'rgba(131, 59, 14,0.12)' : 'transparent',
                    }}
                  >
                    <span className="block text-sm text-[#1A1A1A] font-medium">▦ {g.name}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>Grupo consolidado</span>
                  </button>
                ))}
                {properties.length > 0 && (
                  <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest" style={{ color: 'rgba(26,26,26,0.35)' }}>Propiedades</div>
                )}
                {properties.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { router.push(`/dashboard/${p.id}/overview`); setShowPropMenu(false) }}
                    className="w-full text-left px-4 py-3 transition-colors duration-150 cursor-pointer"
                    style={{
                      borderBottom: '1px solid rgba(26,26,26,0.05)',
                      backgroundColor: p.id === activePropertyId ? 'rgba(131, 59, 14,0.12)' : 'transparent',
                    }}
                    onMouseEnter={e => {
                      if (p.id !== activePropertyId)
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(131, 59, 14,0.08)'
                    }}
                    onMouseLeave={e => {
                      if (p.id !== activePropertyId)
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    <span className="block text-sm text-[#1A1A1A] font-medium">{p.name}</span>
                    {(p as any).city && (
                      <span className="block text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>
                        {(p as any).city}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          activeProperty && (
            <span className="text-sm hidden md:block max-w-[160px] truncate" style={{ color: 'rgba(26,26,26,0.4)' }}>
              {activeProperty.name}
            </span>
          )
        )}
      </div>

      {/* ── Center: nav links ── */}
      <div className="flex-1 flex justify-center">
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(link => {
            const active = isActive(link.href)
            return (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300"
                style={{
                  color: active ? '#833B0E' : 'rgba(26,26,26,0.45)',
                  backgroundColor: active ? 'rgba(131, 59, 14,0.15)' : 'transparent',
                }}
                onMouseEnter={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = '#833B0E'
                }}
                onMouseLeave={e => {
                  if (!active) (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.45)'
                }}
              >
                {link.label}
                {link.ai && !active && (
                  <span
                    className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'rgba(131, 59, 14,0.25)', color: '#833B0E' }}
                  >
                    AI
                  </span>
                )}
              </Link>
            )
          })}
          {/* Analytics + Equipo NOK — always visible */}
          {[analyticsLink, equipoLink].map(link => (
            <Link
              key={link.href}
              href={link.href}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300"
              style={{
                color: isActive(link.href) ? '#833B0E' : 'rgba(26,26,26,0.45)',
                backgroundColor: isActive(link.href) ? 'rgba(131, 59, 14,0.15)' : 'transparent',
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Right: idioma + bell + avatar ── */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Selector de idioma */}
        <div className="hidden sm:flex items-center rounded-full overflow-hidden" style={{ border: '1px solid rgba(26,26,26,0.1)' }}>
          {(['es', 'en'] as Locale[]).map(l => (
            <button
              key={l}
              onClick={() => switchLocale(l)}
              className="px-2.5 py-1 text-[11px] font-semibold uppercase cursor-pointer transition-colors"
              style={{
                backgroundColor: locale === l ? 'rgba(131,59,14,0.15)' : 'transparent',
                color: locale === l ? '#833B0E' : 'rgba(26,26,26,0.35)',
              }}
            >
              {l}
            </button>
          ))}
        </div>

        {/* Notification bell */}
        <button
          className="w-9 h-9 flex items-center justify-center rounded-full transition-all duration-200 cursor-pointer"
          style={{
            color: 'rgba(26,26,26,0.4)',
            border: '1px solid rgba(26,26,26,0.08)',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.color = '#1A1A1A'
            ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(131, 59, 14,0.4)'
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.4)'
            ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(26,26,26,0.08)'
          }}
          aria-label="Notificaciones"
        >
          <BellIcon />
        </button>

        {/* Owner avatar dropdown */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setShowUserMenu(v => !v)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold cursor-pointer transition-all duration-200"
            style={{
              background: 'rgba(131, 59, 14,0.25)',
              border: '2px solid #833B0E',
              color: '#833B0E',
              boxShadow: showUserMenu ? '0 0 0 3px rgba(131, 59, 14,0.2)' : 'none',
            }}
          >
            {owner.name.charAt(0).toUpperCase()}
          </button>

          {showUserMenu && (
            <div
              className="absolute top-full right-0 mt-2 rounded-xl overflow-hidden z-50 min-w-52"
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid rgba(26,26,26,0.08)',
                boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
              }}
            >
              <div
                className="px-4 py-3.5"
                style={{ borderBottom: '1px solid rgba(26,26,26,0.06)' }}
              >
                <p className="text-sm font-medium text-[#1A1A1A]">{owner.name}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(26,26,26,0.4)' }}>{owner.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-4 py-3 text-sm transition-colors duration-150 cursor-pointer"
                style={{ color: 'rgba(26,26,26,0.45)' }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.color = '#F20022'
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(242,0,34,0.05)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.color = 'rgba(26,26,26,0.45)'
                  ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                }}
              >
                {L.cerrarSesion}
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
