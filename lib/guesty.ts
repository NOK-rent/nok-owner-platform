/**
 * Guesty API wrapper — OAuth2 client credentials
 * Docs: https://open-api.guesty.com/docs
 *
 * Rate-limit protection strategy:
 *  1. OAuth token is cached in memory — only refreshed when expired (tokens last ~24h)
 *  2. All page data comes from Supabase (synced via /api/sync/guesty), never directly from Guesty
 *  3. The sync endpoint enforces a 30-min cooldown per property (checked in the route)
 *  4. next: { revalidate } on fetch calls provides an additional Next.js layer cache
 */

import { createServiceClient } from '@/lib/supabase/server'

const BASE_URL = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const CLIENT_ID = process.env.GUESTY_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GUESTY_CLIENT_SECRET || ''
const TOKEN_CACHE_KEY = 'guesty_access_token'

// ─── OAuth token cache ─────────────────────────────────────────────────────
// Two-layer cache:
//  1. In-memory (fast, lost on cold start)
//  2. Supabase system_cache table (persistent across cold starts)
// This prevents hitting the Guesty OAuth rate limit on every serverless invocation.

let memoryCache: { token: string; expiresAt: number } | null = null

export async function getAccessToken(): Promise<string> {
  // 1. Check in-memory cache
  if (memoryCache && Date.now() < memoryCache.expiresAt - 60_000) {
    return memoryCache.token
  }

  // 2. Check Supabase persistent cache
  try {
    const sb = createServiceClient()
    const { data: cached } = await sb
      .from('system_cache')
      .select('value, expires_at')
      .eq('key', TOKEN_CACHE_KEY)
      .single()

    if (cached && new Date(cached.expires_at).getTime() > Date.now() + 60_000) {
      memoryCache = { token: cached.value, expiresAt: new Date(cached.expires_at).getTime() }
      return cached.value
    }
  } catch {
    // Cache miss — proceed to fetch
  }

  // 3. Fetch new token from Guesty
  const res = await fetch('https://open-api.guesty.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
    cache: 'no-store',
  }).catch((err) => {
    throw new Error(`Guesty OAuth network error: ${err.message}`)
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Guesty OAuth error ${res.status}: ${body}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // Save to memory
  memoryCache = { token: data.access_token, expiresAt: new Date(expiresAt).getTime() }

  // Save to Supabase (fire and forget)
  try {
    const sb = createServiceClient()
    await sb.from('system_cache').upsert({
      key: TOKEN_CACHE_KEY,
      value: data.access_token,
      expires_at: expiresAt,
    })
  } catch {
    // Non-critical — memory cache still works
  }

  return data.access_token
}

// ─── Core fetch helper ─────────────────────────────────────────────────────

async function guestyFetch<T>(
  path: string,
  options?: RequestInit & {
    params?: Record<string, string | number | undefined>
    revalidate?: number
  }
): Promise<T> {
  const { params, revalidate = 300, ...fetchOptions } = options ?? {}

  const token = await getAccessToken()

  const url = new URL(`${BASE_URL}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined) url.searchParams.set(k, String(v))
    })
  }

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(fetchOptions.headers ?? {}),
    },
    next: { revalidate },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Guesty API error ${res.status} on ${path}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface GuestyReservation {
  _id: string
  listingId: string
  status: string
  checkIn: string   // ISO date
  checkOut: string
  nightsCount: number
  guest: {
    _id: string
    fullName: string
    email: string
    phone: string
    countryCode: string
  }
  guestsCount: number
  money: {
    totalPaid: number
    hostPayout: number
    currency: string
  }
  source: string   // 'Airbnb', 'Booking.com', 'Direct', etc.
  createdAt: string
  updatedAt: string
}

export interface GuestyReview {
  _id: string
  listingId: string
  reservationId: string
  publicReview: string
  privateReview: string
  hostResponse: string
  rating: number           // overall 1-5
  categoryRatings?: {
    cleanliness?: number
    communication?: number
    checkIn?: number
    accuracy?: number
    location?: number
    value?: number
  }
  reviewee: {
    fullName: string
  }
  submittedAt: string
  source: string
}

export interface GuestyListing {
  _id: string
  title: string
  address: {
    full: string
    city: string
    country: string
  }
  bedrooms: number
  bathrooms: number
  accommodates: number
  pictures: Array<{ thumbnail: string; regular: string }>
  publicDescription: { summary: string }
}

export interface GuestyCalendarDay {
  date: string         // YYYY-MM-DD
  status: 'available' | 'unavailable' | 'booked'
  price: number
  minNights: number
  note?: string
  reservationId?: string
  blockReason?: string
  // Wheelhouse fields (present when Wheelhouse is connected to Guesty)
  suggestedPrice?: number       // Wheelhouse suggestion before any manual override
  revenue?: number              // Expected revenue
  basePriceOverride?: number    // Manually overridden price
}

export interface GuestyPaginatedResponse<T> {
  results: T[]
  total: number
  skip: number
  limit: number
}

// ─── Listings ──────────────────────────────────────────────────────────────

export async function getListing(listingId: string): Promise<GuestyListing> {
  return guestyFetch<GuestyListing>(`/listings/${listingId}`, { revalidate: 3600 })
}

export async function getListings(ids: string[]): Promise<GuestyListing[]> {
  const res = await guestyFetch<GuestyPaginatedResponse<GuestyListing>>('/listings', {
    params: { ids: ids.join(','), limit: 100 },
    revalidate: 3600, // listings change rarely
  })
  return res.results
}

// ─── Reservations ──────────────────────────────────────────────────────────

export async function getReservations(
  listingId: string,
  options?: {
    status?: string
    checkInFrom?: string   // YYYY-MM-DD
    checkInTo?: string
    limit?: number
    skip?: number
  }
): Promise<{ reservations: GuestyReservation[]; total: number }> {
  const res = await guestyFetch<GuestyPaginatedResponse<GuestyReservation>>('/reservations', {
    params: {
      'filters[0][field]': 'listingId',
      'filters[0][operator]': '$eq',
      'filters[0][value]': listingId,
      ...(options?.status ? {
        'filters[1][field]': 'status',
        'filters[1][operator]': '$eq',
        'filters[1][value]': options.status,
      } : {}),
      checkIn_gte: options?.checkInFrom,
      checkIn_lte: options?.checkInTo,
      limit: options?.limit ?? 50,
      skip: options?.skip ?? 0,
      fields: '_id listingId status checkIn checkOut nightsCount guest guestsCount money source createdAt updatedAt',
    },
    revalidate: 300,
  })
  return { reservations: res.results, total: res.total }
}

export async function getConfirmedReservations(
  listingId: string,
  from?: string,
  to?: string
): Promise<GuestyReservation[]> {
  const { reservations } = await getReservations(listingId, {
    status: 'confirmed',
    checkInFrom: from,
    checkInTo: to,
    limit: 100,
  })
  return reservations
}

export async function getUpcomingReservations(listingId: string): Promise<GuestyReservation[]> {
  const today = new Date().toISOString().split('T')[0]
  const sixMonthsOut = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]
  return getConfirmedReservations(listingId, today, sixMonthsOut)
}

// ─── Reviews ───────────────────────────────────────────────────────────────

export async function getReviews(
  listingId: string,
  limit = 20
): Promise<GuestyReview[]> {
  const res = await guestyFetch<any>('/reviews', {
    params: { listingId, limit },
    revalidate: 3600,
  })
  // Guesty may return { results: [] } or { data: [] } or a plain array
  if (Array.isArray(res)) return res
  if (Array.isArray(res?.results)) return res.results
  if (Array.isArray(res?.data)) return res.data
  return []
}

export async function getReviewStats(listingId: string): Promise<{
  count: number
  averageRating: number
  averageCleanliness: number
  averageCommunication: number
  averageValue: number
}> {
  const reviews = await getReviews(listingId, 100)
  if (!reviews.length) {
    return { count: 0, averageRating: 0, averageCleanliness: 0, averageCommunication: 0, averageValue: 0 }
  }
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  return {
    count: reviews.length,
    averageRating: avg(reviews.map(r => r.rating)),
    averageCleanliness: avg(reviews.filter(r => r.categoryRatings?.cleanliness).map(r => r.categoryRatings!.cleanliness!)),
    averageCommunication: avg(reviews.filter(r => r.categoryRatings?.communication).map(r => r.categoryRatings!.communication!)),
    averageValue: avg(reviews.filter(r => r.categoryRatings?.value).map(r => r.categoryRatings!.value!)),
  }
}

// ─── Pricing Calendar ──────────────────────────────────────────────────────

export async function getPricingCalendar(
  listingId: string,
  from: string,   // YYYY-MM-DD
  to: string
): Promise<GuestyCalendarDay[]> {
  const res = await guestyFetch<{ days: GuestyCalendarDay[] } | GuestyCalendarDay[]>(
    `/listings/${listingId}/calendar`,
    { params: { from, to }, revalidate: 900 }
  )
  return Array.isArray(res) ? res : (res.days ?? [])
}

/**
 * Returns pricing data for a named period (e.g. "Semana Santa", "Navidad").
 * The AI uses this to answer "¿cuánto cuesta el apartamento en Semana Santa?"
 */
export async function getPricingForPeriod(
  listingId: string,
  checkIn: string,
  checkOut: string
): Promise<{
  days: GuestyCalendarDay[]
  available: boolean
  avgNightlyRate: number
  totalNights: number
  estimatedTotal: number
}> {
  const days = await getPricingCalendar(listingId, checkIn, checkOut)
  const available = days.every(d => d.status === 'available')
  const bookedDays = days.filter(d => d.price > 0)
  const avgNightlyRate = bookedDays.length
    ? bookedDays.reduce((sum, d) => sum + d.price, 0) / bookedDays.length
    : 0
  const totalNights = days.length
  const estimatedTotal = avgNightlyRate * totalNights

  return { days, available, avgNightlyRate, totalNights, estimatedTotal }
}

// ─── Revenue summary ───────────────────────────────────────────────────────

export async function getMonthlyRevenue(
  listingId: string,
  year: number,
  month: number  // 1-12
): Promise<{ revenue: number; reservationCount: number; currency: string }> {
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).toISOString().split('T')[0]

  const { reservations } = await getReservations(listingId, {
    status: 'confirmed',
    checkInFrom: firstDay,
    checkInTo: lastDay,
    limit: 100,
  })

  const revenue = reservations.reduce((sum, r) => sum + (r.money.hostPayout ?? 0), 0)
  const currency = reservations[0]?.money.currency ?? 'USD'

  return { revenue, reservationCount: reservations.length, currency }
}
