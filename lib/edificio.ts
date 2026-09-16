/**
 * Edificios (un propietario, N unidades) — carga + control de acceso.
 *
 * Entidad: building_pnl_configs (compartida con Gardens/Ekkos). Un owner ve el
 * edificio si (a) es admin, (b) config.owner_id es su owner, (c) su email (o
 * additional_emails) está en config.shared_emails, o (d) es dueño de ≥1 de las
 * unidades del edificio.
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { redirect, notFound } from 'next/navigation'
import type { BuildingConfig } from '@/lib/building-pnl'

export interface BuildingLite { id: string; name: string; propertyCount: number; city: string | null; slug: string | null }

export interface BuildingProperty {
  id: string; name: string; active: boolean; city: string | null; bedrooms: number | null
  guesty_listing_id: string | null; wheelhouse_property_id: string | null; owner_id: string | null
  cover_image_url: string | null
}

function normalizeConfig(row: any): BuildingConfig {
  return {
    id: row.id,
    name: row.name,
    property_ids: Array.isArray(row.property_ids) ? row.property_ids : [],
    commission_rate_on_net: Number(row.commission_rate_on_net ?? 0) || 0,
    active: row.active !== false,
    owner_id: row.owner_id ?? null,
    shared_emails: Array.isArray(row.shared_emails) ? row.shared_emails : [],
    start_month: row.start_month ?? null,
    commission_threshold_cop: Number(row.commission_threshold_cop ?? 0) || 0,
    commission_threshold_basis: row.commission_threshold_basis === 'gross' ? 'gross' : 'noi',
    city: row.city ?? null,
    country: row.country ?? null,
    slug: row.slug ?? null,
  }
}

function ownerEmails(owner: { email?: string | null; additional_emails?: string[] | null }): string[] {
  const list = [owner.email, ...(Array.isArray(owner.additional_emails) ? owner.additional_emails : [])]
  return list.filter((e): e is string => !!e).map(e => e.toLowerCase())
}

/**
 * Solo las configs con `slug` están habilitadas para el portal. Gardens/Ekkos
 * (sin slug) siguen viviendo en nok-special-properties con su propio modelo de
 * comisión; sin este filtro, cualquier dueño de una unidad de esos edificios
 * vería el P&L completo del edificio acá.
 */
export function isPortalEnabled(config: BuildingConfig): boolean {
  return !!config.slug
}

/** ¿Este owner puede ver esta config? (sin tocar la DB más allá de sus propiedades). */
export function canAccessBuilding(
  config: BuildingConfig,
  owner: { id: string; email?: string | null; additional_emails?: string[] | null },
  ownedPropertyIds: string[],
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (!isPortalEnabled(config)) return false
  if (config.owner_id && config.owner_id === owner.id) return true
  const emails = ownerEmails(owner)
  if ((config.shared_emails ?? []).some(e => emails.includes((e || '').toLowerCase()))) return true
  return config.property_ids.some(id => ownedPropertyIds.includes(id))
}

/** Edificios visibles para un owner ya autenticado (para nav/landing). */
export async function listOwnerBuildings(
  sb: any,
  owner: { id: string; email?: string | null; additional_emails?: string[] | null },
  isAdmin: boolean,
): Promise<BuildingLite[]> {
  const { data: rows, error } = await sb.from('building_pnl_configs').select('*').eq('active', true).order('name')
  if (error || !rows) return []
  let owned: string[] = []
  if (!isAdmin) {
    const { data: props } = await sb.from('properties').select('id').eq('owner_id', owner.id)
    owned = (props ?? []).map((p: any) => p.id)
  }
  return rows
    .map(normalizeConfig)
    .filter((c: BuildingConfig) => isPortalEnabled(c) && canAccessBuilding(c, owner, owned, isAdmin))
    .map((c: BuildingConfig) => ({ id: c.id, name: c.name, propertyCount: c.property_ids.length, city: c.city ?? null, slug: c.slug ?? null }))
}

/**
 * Carga edificio + unidades para páginas del portal. Redirige a /login sin
 * sesión y devuelve 404 si el owner no tiene acceso.
 */
export async function loadOwnerBuilding(configId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, name, email, additional_emails, locale').eq('supabase_user_id', user.id).single()
  if (!owner) redirect('/login')
  const isAdmin = isAdminEmail(owner.email)

  const result = await resolveBuilding(sb, configId, owner, isAdmin)
  if (!result) notFound()
  return { owner, isAdmin, sb, ...result }
}

/** Versión sin redirect/notFound para API routes. Devuelve null si no hay acceso. */
export async function resolveBuilding(
  sb: any,
  configId: string,
  owner: { id: string; email?: string | null; additional_emails?: string[] | null },
  isAdmin: boolean,
): Promise<{ config: BuildingConfig; properties: BuildingProperty[]; propertyIds: string[] } | null> {
  const { data: row } = await sb.from('building_pnl_configs').select('*').eq('id', configId).maybeSingle()
  if (!row) return null
  const config = normalizeConfig(row)

  let owned: string[] = []
  if (!isAdmin) {
    const { data: props } = await sb.from('properties').select('id').eq('owner_id', owner.id)
    owned = (props ?? []).map((p: any) => p.id)
  }
  if (!canAccessBuilding(config, owner, owned, isAdmin)) return null

  const { data: props } = config.property_ids.length
    ? await sb.from('properties')
        .select('id, name, active, city, bedrooms, guesty_listing_id, wheelhouse_property_id, owner_id, cover_image_url')
        .in('id', config.property_ids)
    : { data: [] as any[] }
  const properties: BuildingProperty[] = (props ?? [])
    .map((p: any) => ({ ...p, name: (p.name ?? '').trim() }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'es', { numeric: true }))

  return { config, properties, propertyIds: properties.map(p => p.id) }
}

/** Carga sin sesión (M2M desde nok-hub con ?secret=). */
export async function resolveBuildingUnauthenticated(sb: any, configId: string) {
  const { data: row } = await sb.from('building_pnl_configs').select('*').eq('id', configId).maybeSingle()
  if (!row) return null
  const config = normalizeConfig(row)
  const { data: props } = config.property_ids.length
    ? await sb.from('properties')
        .select('id, name, active, city, bedrooms, guesty_listing_id, wheelhouse_property_id, owner_id, cover_image_url')
        .in('id', config.property_ids)
    : { data: [] as any[] }
  const properties: BuildingProperty[] = (props ?? [])
    .map((p: any) => ({ ...p, name: (p.name ?? '').trim() }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'es', { numeric: true }))
  return { config, properties, propertyIds: properties.map(p => p.id) }
}

/**
 * Secret M2M compartido con nok-hub (header `x-sync-secret`). Falla cerrado:
 * sin OWNER_PORTAL_SECRET configurado nadie pasa. Sin literal legacy.
 */
export function hasValidMachineSecret(req: Request): boolean {
  const expected = process.env.OWNER_PORTAL_SECRET
  if (!expected) return false
  const s = req.headers.get('x-sync-secret')
  return !!s && s === expected
}
