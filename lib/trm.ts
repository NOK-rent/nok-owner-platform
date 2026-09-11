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

// ── TRM por mes reportado ────────────────────────────────────────────────────
// Los costos en COP/DOP (limpieza, utilities, mantenimiento) se convierten con
// el promedio mensual del mes al que pertenecen, no con la tasa de hoy: con el
// peso moviéndose >15% en un semestre, la tasa actual distorsiona meses cerrados.
// Fuente: Yahoo Finance (closes diarios USDCOP=X / USDDOP=X), igual que nok-hub.
// Caché: system_cache, 400 días para meses cerrados, 24h para el mes en curso.

type FxCurrency = 'COP' | 'DOP'
const MONTH_CACHE_TTL_CLOSED_MS = 400 * 24 * 60 * 60 * 1000
const monthMemCache = new Map<string, { rate: number; expiresAt: number }>()

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 'YYYY-MM-DD' | 'YYYY-MM' → 'YYYY-MM' */
export function monthKeyOf(date: string): string {
  return (date || '').slice(0, 7)
}

async function fetchYahooMonthlyAverage(currency: FxCurrency, monthKey: string): Promise<number | null> {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m) return null
  const start = Math.floor(Date.UTC(y, m - 1, 1) / 1000)
  const end = Math.floor(Date.UTC(y, m, 1) / 1000)
  const res = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/USD${currency}=X?period1=${start}&period2=${end}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; nok-owners/1.0)' }, cache: 'no-store' },
  )
  if (!res.ok) return null
  const data = await res.json()
  const closes: number[] = (data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [])
    .filter((v: number | null): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
  if (closes.length === 0) return null
  return closes.reduce((s, v) => s + v, 0) / closes.length
}

/** Promedio mensual USD→{COP,DOP} del mes indicado. Fallback: tasa actual. */
export async function getMonthlyRate(currency: FxCurrency, monthKey: string): Promise<number> {
  const isClosed = monthKey < currentMonthKey()
  const cacheKey = `fx_month_usd_${currency.toLowerCase()}_${monthKey}`
  const fallback = () => (currency === 'COP' ? getUSDtoCOPRate() : getUSDtoDOPRate())

  const mem = monthMemCache.get(cacheKey)
  if (mem && Date.now() < mem.expiresAt) return mem.rate

  try {
    const sb = createServiceClient()
    const { data } = await sb.from('system_cache').select('value, expires_at').eq('key', cacheKey).single()
    if (data && new Date(data.expires_at).getTime() > Date.now()) {
      const rate = parseFloat(data.value)
      monthMemCache.set(cacheKey, { rate, expiresAt: new Date(data.expires_at).getTime() })
      return rate
    }
  } catch { /* miss */ }

  try {
    const rate = await fetchYahooMonthlyAverage(currency, monthKey)
    if (!rate) throw new Error('no data')
    const ttl = isClosed ? MONTH_CACHE_TTL_CLOSED_MS : CACHE_TTL_MS
    const expiresAt = new Date(Date.now() + ttl).toISOString()
    monthMemCache.set(cacheKey, { rate, expiresAt: new Date(expiresAt).getTime() })
    try {
      const sb = createServiceClient()
      await sb.from('system_cache').upsert({ key: cacheKey, value: String(rate), expires_at: expiresAt })
    } catch { /* non-critical */ }
    return rate
  } catch {
    return fallback()
  }
}

export interface MonthlyFx {
  /** Tasa USD→currency del mes; si el mes no fue precargado usa la tasa actual. */
  rate(currency: FxCurrency, monthKey: string): number
  /** Convierte a USD con la tasa del mes indicado (acepta 'YYYY-MM' o 'YYYY-MM-DD'). */
  toUSD(amount: number, currency: string | null | undefined, monthOrDate: string): number
  /** TRM COP del primer mes precargado — para la nota "TRM aplicada" del statement. */
  copRateLabel: number
}

/**
 * Precarga las tasas de los meses que la página va a necesitar (una llamada por
 * mes/moneda, cacheadas) y devuelve conversores sincrónicos para usar en loops.
 */
export async function loadMonthlyFx(monthKeys: string[]): Promise<MonthlyFx> {
  const keys = Array.from(new Set(monthKeys.filter(k => /^\d{4}-\d{2}$/.test(k))))
  const [current, currentDop, ...monthly] = await Promise.all([
    getUSDtoCOPRate(),
    getUSDtoDOPRate(),
    ...keys.flatMap(k => [getMonthlyRate('COP', k), getMonthlyRate('DOP', k)]),
  ])
  const table = new Map<string, number>()
  keys.forEach((k, i) => {
    table.set(`COP|${k}`, monthly[i * 2])
    table.set(`DOP|${k}`, monthly[i * 2 + 1])
  })
  const rate = (currency: FxCurrency, monthKey: string) =>
    table.get(`${currency}|${monthKey}`) ?? (currency === 'COP' ? current : currentDop)
  return {
    rate,
    toUSD(amount, currency, monthOrDate) {
      const c = (currency || 'USD').toUpperCase()
      if (c === 'COP') return amount / rate('COP', monthKeyOf(monthOrDate))
      if (c === 'DOP') return amount / rate('DOP', monthKeyOf(monthOrDate))
      return amount
    },
    copRateLabel: keys.length ? rate('COP', keys[0]) : current,
  }
}
