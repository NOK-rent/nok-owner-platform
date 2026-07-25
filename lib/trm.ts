/**
 * TRM (Tasa Representativa del Mercado) — COP → USD exchange rate
 *
 * Source: api.exchangerate-api.com (free tier, 1500 req/month)
 * Cache: Supabase system_cache, TTL = 24 hours
 *
 * Usage:
 *   const rate = await getUSDtoCOPRate()   // e.g. 4100
 *   const usd = copAmount / rate
 */

import { createServiceClient } from '@/lib/supabase/server'

const CACHE_KEY = 'trm_usd_cop'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 24 hours

let memCache: { rate: number; expiresAt: number } | null = null

export async function getUSDtoCOPRate(): Promise<number> {
  // 1. Memory cache
  if (memCache && Date.now() < memCache.expiresAt) {
    return memCache.rate
  }

  // 2. Supabase cache
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('system_cache')
      .select('value, expires_at')
      .eq('key', CACHE_KEY)
      .single()

    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      const rate = parseFloat(data.value)
      memCache = { rate, expiresAt: new Date(data.expires_at).getTime() }
      return rate
    }
  } catch {
    // Cache miss — fetch fresh
  }

  // 3. Fetch from free API
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      cache: 'no-store',
    })

    if (!res.ok) throw new Error(`Exchange rate API ${res.status}`)

    const data = await res.json()
    const rate: number = data.rates?.COP ?? 4200  // fallback if API fails

    // Save to memory
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString()
    memCache = { rate, expiresAt: new Date(expiresAt).getTime() }

    // Save to Supabase (fire and forget)
    try {
      const sb = createServiceClient()
      await sb.from('system_cache').upsert({
        key: CACHE_KEY,
        value: String(rate),
        expires_at: expiresAt,
      })
    } catch {
      // Non-critical
    }

    return rate
  } catch {
    // Last resort fallback
    return memCache?.rate ?? 4200
  }
}

/**
 * Convert COP amount to USD using cached TRM rate.
 */
export async function copToUSD(copAmount: number): Promise<number> {
  const rate = await getUSDtoCOPRate()
  return copAmount / rate
}

// ── DOP (peso dominicano) → USD, mismo patrón/caché que COP ──
const DOP_CACHE_KEY = 'trm_usd_dop'
let dopMemCache: { rate: number; expiresAt: number } | null = null

export async function getUSDtoDOPRate(): Promise<number> {
  if (dopMemCache && Date.now() < dopMemCache.expiresAt) return dopMemCache.rate
  try {
    const sb = createServiceClient()
    const { data } = await sb.from('system_cache').select('value, expires_at').eq('key', DOP_CACHE_KEY).single()
    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      const rate = parseFloat(data.value)
      dopMemCache = { rate, expiresAt: new Date(data.expires_at).getTime() }
      return rate
    }
  } catch { /* miss */ }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' })
    if (!res.ok) throw new Error(`Exchange rate API ${res.status}`)
    const data = await res.json()
    const rate: number = data.rates?.DOP ?? 60 // fallback
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString()
    dopMemCache = { rate, expiresAt: new Date(expiresAt).getTime() }
    try {
      const sb = createServiceClient()
      await sb.from('system_cache').upsert({ key: DOP_CACHE_KEY, value: String(rate), expires_at: expiresAt })
    } catch { /* non-critical */ }
    return rate
  } catch {
    return dopMemCache?.rate ?? 60
  }
}

/** Convierte cualquier moneda soportada a USD (USD passthrough, COP y DOP con su TRM). */
export async function toUSDByCurrency(amount: number, currency: string | null | undefined): Promise<number> {
  const c = (currency || 'USD').toUpperCase()
  if (c === 'COP') return amount / (await getUSDtoCOPRate())
  if (c === 'DOP') return amount / (await getUSDtoDOPRate())
  return amount
}
