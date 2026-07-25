/**
 * POST /api/sync/guesty?propertyId=xxx
 *
 * Pulls data from Guesty and upserts into Supabase:
 *   - Reservations (last 6 months + next 12 months)
 *   - Reviews (last 50)
 *   - Pricing calendar (next 12 months)
 *
 * Called manually from the Calendar page or via cron.
 */

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  getConfirmedReservations,
  getReviews,
  getPricingCalendar,
  getReservations,
} from '@/lib/guesty'

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url)
  const propertyId = searchParams.get('propertyId')

  if (!propertyId) {
    return NextResponse.json({ error: 'propertyId required' }, { status: 400 })
  }

  // Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient()

  // Get property + verify ownership
  const propertyRes = await sb.from('properties').select('*').eq('id', propertyId).single()
  if (propertyRes.error || !propertyRes.data) {
    return NextResponse.json({ error: 'Property not found' }, { status: 404 })
  }
  const property = propertyRes.data

  const ownerRes = await sb.from('owners').select('id').eq('supabase_user_id', user.id).single()
  if (ownerRes.error || ownerRes.data?.id !== property.owner_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guestyListingId = property.guesty_listing_id ?? property.hostify_property_id
  if (!guestyListingId) {
    return NextResponse.json({
      error: 'No Guesty listing ID configured for this property',
      hint: 'Set guesty_listing_id in the properties table'
    }, { status: 422 })
  }

  // Throttle disabled temporarily for testing

  const results = { reservations: 0, reviews: 0, pricing: 0, errors: [] as string[] }

  const today = new Date()
  const sixMonthsAgo = new Date(today); sixMonthsAgo.setMonth(today.getMonth() - 6)
  const twelveMonthsOut = new Date(today); twelveMonthsOut.setMonth(today.getMonth() + 12)

  const fmt = (d: Date) => d.toISOString().split('T')[0]

  // ── 1. Sync reservations ─────────────────────────────────────
  try {
    const { reservations } = await getReservations(guestyListingId, {
      checkInFrom: fmt(sixMonthsAgo),
      checkInTo: fmt(twelveMonthsOut),
      limit: 100,
    })

    // Filter to only this listing's reservations (Guesty API filter not always reliable)
    const firstR = reservations[0] as any
    const listingField = firstR?.listingId ? 'listingId' : firstR?.listing_id ? 'listing_id' : 'listingId'
    const filtered = reservations.filter((r: any) => (r[listingField] ?? r.listingId) === guestyListingId)
    results.errors.push(`DEBUG: ${reservations.length} total, ${filtered.length} for listing ${guestyListingId}, field=${listingField}, sample=${firstR?.[listingField]}`)
    for (const r of filtered) {
      const row = {
        property_id: propertyId,
        guesty_reservation_id: r._id,
        guesty_listing_id: r.listingId,
        status: r.status,
        check_in: r.checkIn.split('T')[0],
        check_out: r.checkOut.split('T')[0],
        guest_name: r.guest?.fullName ?? null,
        guest_email: r.guest?.email ?? null,
        guest_phone: r.guest?.phone ?? null,
        guest_country: r.guest?.countryCode ?? null,
        num_guests: r.guestsCount ?? null,
        total_price: r.money?.totalPaid ?? null,
        owner_revenue: r.money?.hostPayout ?? null,
        currency: r.money?.currency ?? 'USD',
        channel: r.source ?? null,
        synced_at: new Date().toISOString(),
      }

      await sb.from('reservations').upsert(row, { onConflict: 'guesty_reservation_id' })
      results.reservations++
    }
  } catch (e) {
    results.errors.push(`Reservations: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 2. Sync reviews ──────────────────────────────────────────
  try {
    const reviews = await getReviews(guestyListingId, 50)
    const reviewList = Array.isArray(reviews) ? reviews : ((reviews as any)?.results ?? (reviews as any)?.data ?? [])

    for (const r of reviewList) {
      // Guesty Open API v1 nests review data inside rawReview
      const raw = (r as any).rawReview ?? {}
      const row = {
        property_id: propertyId,
        guesty_review_id: r._id,
        channel: (r as any).channelId ?? r.source ?? null,
        overall_score: raw.overall_rating ?? r.rating ?? null,
        cleanliness_score: raw.category_ratings_cleanliness ?? r.categoryRatings?.cleanliness ?? null,
        communication_score: raw.category_ratings_communication ?? r.categoryRatings?.communication ?? null,
        checkin_score: raw.category_ratings_checkin ?? r.categoryRatings?.checkIn ?? null,
        accuracy_score: raw.category_ratings_accuracy ?? r.categoryRatings?.accuracy ?? null,
        location_score: raw.category_ratings_location ?? r.categoryRatings?.location ?? null,
        value_score: raw.category_ratings_value ?? r.categoryRatings?.value ?? null,
        guest_name: r.reviewee?.fullName ?? null,
        reviewer_text: raw.public_review ?? r.publicReview ?? null,
        host_response: ((r as any).reviewReplies?.[0] as any)?.text ?? r.hostResponse ?? null,
        submitted_at: raw.submitted_at ?? (r as any).createdAt ?? r.submittedAt ?? null,
        synced_at: new Date().toISOString(),
      }

      await sb.from('reviews').upsert(row, { onConflict: 'guesty_review_id' })
      results.reviews++
    }
  } catch (e) {
    results.errors.push(`Reviews: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 3. Sync pricing calendar ─────────────────────────────────
  try {
    const days = await getPricingCalendar(guestyListingId, fmt(today), fmt(twelveMonthsOut))

    for (const d of days) {
      // Wheelhouse recommended rate — use suggestedPrice if available, fallback to price
      const recommendedRate = (d as any).suggestedPrice ?? (d as any).revenue ?? d.price ?? null
      const row = {
        property_id: propertyId,
        calendar_date: d.date,
        base_rate: d.price ?? null,
        recommended_rate: recommendedRate,
        is_available: d.status === 'available',
        is_blocked: d.status === 'unavailable',
        block_reason: d.blockReason ?? null,
        min_stay_nights: d.minNights ?? 2,
        source: 'guesty',
        synced_at: new Date().toISOString(),
      }

      await sb.from('pricing_calendar').upsert(row, { onConflict: 'property_id,calendar_date' })
      results.pricing++
    }
  } catch (e) {
    results.errors.push(`Pricing: ${e instanceof Error ? e.message : String(e)}`)
  }

  return NextResponse.json({
    success: true,
    synced: results,
    message: `Sincronizado: ${results.reservations} reservas, ${results.reviews} reseñas, ${results.pricing} días de precios`,
  })
}
