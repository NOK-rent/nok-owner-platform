/**
 * Modo de despliegue del portal.
 *
 * - owners.nok.rent (genérico): sin NEXT_PUBLIC_PORTAL_BUILDING_SLUG. Oculta los
 *   edificios listados en PORTAL_EXTERNAL_BUILDINGS (tienen su propio sitio).
 * - Sitio de un edificio (p.ej. own96.nok.rent): NEXT_PUBLIC_PORTAL_BUILDING_SLUG=wellness.
 *   Solo existe ese edificio y sus unidades; login con marca propia; crons apagados
 *   (los corre el despliegue genérico); cualquier cuenta @nok.rent es admin.
 *
 * Misma base de código y misma Supabase: cambiar de modo es solo env vars.
 */

export function standaloneSlug(): string | null {
  const s = (process.env.NEXT_PUBLIC_PORTAL_BUILDING_SLUG || '').trim().toLowerCase()
  return s || null
}

export function isStandalone(): boolean {
  return standaloneSlug() !== null
}

export function portalBrand(): string {
  return (process.env.NEXT_PUBLIC_PORTAL_BRAND || '').trim() || 'NOK Owners'
}

/** Slugs de edificios que tienen sitio propio y NO deben aparecer en el portal genérico. */
export function externalBuildingSlugs(): string[] {
  return (process.env.PORTAL_EXTERNAL_BUILDINGS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

export function isTeamEmail(email: string | null | undefined): boolean {
  return /@nok\.rent$/i.test((email || '').trim())
}

/** Respuesta estándar para crons que no deben correr en un sitio de edificio. */
export function cronSkippedInStandalone(): Response | null {
  if (!isStandalone()) return null
  return new Response(JSON.stringify({ skipped: true, reason: 'standalone building portal — crons run on owners.nok.rent' }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}
