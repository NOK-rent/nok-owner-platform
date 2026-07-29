/**
 * GET /api/cron/sync-all?secret=nok-sync-2025&offset=0&batch=10
 *
 * Syncs reservations, reviews, and pricing for a batch of properties.
 * Uses offset-based pagination so Vercel cron can call multiple times,
 * or a single call can chain itself.
 *
 * Query params:
 *   secret  — auth key
 *   offset  — start index (default 0)
 *   batch   — how many properties per call (default 10)
 *   only    — optional: "reservations" | "reviews" | "pricing" to sync only one type
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getReservations, getReviews, getPricingCalendar } from '@/lib/guesty'

export const maxDuration = 300 // 5 minutes

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  const offset = parseInt(searchParams.get('offset') ?? '0')
  const batchSize = parseInt(searchParams.get('batch') ?? '10')
  const only = searchParams.get('only') // optional filter

  if (secret !== 'nok-sync-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient()

  // Get all properties with guesty_listing_id
  const { data: allProperties, error } = await sb
    .from('properties')
    .select('id, name, guesty_listing_id')
    .not('guesty_listing_id', 'is', null)
    .order('name')

  if (error || !allProperties) {
    return NextResponse.json({ error: error?.message ?? 'No properties found' }, { status: 500 })
  }

  const properties = allProperties.slice(offset, offset + batchSize)

  if (properties.length === 0) {
    return NextResponse.json({
      success: true,
      message: 'No more properties to sync',
      totalProperties: allProperties.length,
      offset,
      done: true,
    })
  }

  const today = new Date()
  const sixMonthsAgo = new Date(today); sixMonthsAgo.setMonth(today.getMonth() - 6)
  const twelveMonthsOut = new Date(today); twelveMonthsOut.setMonth(today.getMonth() + 12)
  const sixMonthsOut = new Date(today); sixMonthsOut.setMonth(today.getMonth() + 6)
  const fmt = (d: Date) => d.toISOString().split('T')[0]

  const results = {
    totalProperties: allProperties.length,
    batchStart: offset,
    batchEnd: offset + properties.length,
    synced: 0,
    errors: [] as string[],
    reservations: 0,
    reviews: 0,
    pricing: 0,
  }

  const syncReservations = !only || only === 'reservations'
  const syncReviews = !only || only === 'reviews'
  const syncPricing = !only || only === 'pricing'

  // Process 3 at a time to avoid rate limits but still be fast
  const CONCURRENT = 3
  for (let i = 0; i < properties.length; i += CONCURRENT) {
    const batch = properties.slice(i, i + CONCURRENT)

    await Promise.all(batch.map(async (property) => {
      const guestyId = property.guesty_listing_id
      const propertyId = property.id

      try {
        // 1. Reservations — batch upsert
        if (syncReservations) {
          try {
            const { reservations } = await getReservations(guestyId, {
              checkInFrom: fmt(sixMonthsAgo),
              checkInTo: fmt(twelveMonthsOut),
              limit: 100,
            })

            const filtered = reservations.filter((r: any) => (r.listingId ?? r.listing_id) === guestyId)
            if (filtered.length > 0) {
              const rows = filtered.map((r: any) => ({
                property_id: propertyId,
                guesty_reservation_id: r._id,
                guesty_listing_id: r.listingId,
                status: r.status,
                check_in: r.checkIn?.split('T')[0],
                check_out: r.checkOut?.split('T')[0],
                guest_name: r.guest?.fullName ?? null,
                guest_email: r.guest?.email ?? null,
                guest_phone: r.guest?.phone ?? null,
                guest_country: r.guest?.countryCode ?? null,
                num_guests: r.guestsCount ?? null,
                total_price: r.money?.totalPaid ?? null,
                owner_revenue: r.money?.ownerRevenue ?? r.money?.hostPayout ?? null, // owner_revenue del listing, NO el payout real
                currency: r.money?.currency ?? 'USD',
                channel: r.source ?? null,
                synced_at: new Date().toISOString(),
              }))
              const { error: upsertErr } = await sb.from('reservations').upsert(rows, { onConflict: 'guesty_reservation_id' })
              if (upsertErr) results.errors.push(`${property.name} reservations: ${upsertErr.message}`)
              else results.reservations += rows.length
            }
          } catch (e) {
            results.errors.push(`${property.name} reservations: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // 2. Reviews — batch upsert
        if (syncReviews) {
          try {
            const reviews = await getReviews(guestyId, 50)
            const reviewList = Array.isArray(reviews) ? reviews : ((reviews as any)?.results ?? (reviews as any)?.data ?? [])
            if (reviewList.length > 0) {
              const rows = reviewList.map((r: any) => {
                const raw = r.rawReview ?? {}
                return {
                  property_id: propertyId,
                  guesty_review_id: r._id,
                  channel: r.channelId ?? r.source ?? null,
                  overall_score: raw.overall_rating ?? r.rating ?? null,
                  cleanliness_score: raw.category_ratings_cleanliness ?? r.categoryRatings?.cleanliness ?? null,
                  communication_score: raw.category_ratings_communication ?? r.categoryRatings?.communication ?? null,
                  checkin_score: raw.category_ratings_checkin ?? r.categoryRatings?.checkIn ?? null,
                  accuracy_score: raw.category_ratings_accuracy ?? r.categoryRatings?.accuracy ?? null,
                  location_score: raw.category_ratings_location ?? r.categoryRatings?.location ?? null,
                  value_score: raw.category_ratings_value ?? r.categoryRatings?.value ?? null,
                  guest_name: r.reviewee?.fullName ?? null,
                  reviewer_text: raw.public_review ?? r.publicReview ?? null,
                  host_response: (r.reviewReplies?.[0] as any)?.text ?? r.hostResponse ?? null,
                  submitted_at: raw.submitted_at ?? r.createdAt ?? r.submittedAt ?? null,
                  synced_at: new Date().toISOString(),
                }
              })
              const { error: upsertErr } = await sb.from('reviews').upsert(rows, { onConflict: 'guesty_review_id' })
              if (upsertErr) results.errors.push(`${property.name} reviews: ${upsertErr.message}`)
              else results.reviews += rows.length
            }
          } catch (e) {
            results.errors.push(`${property.name} reviews: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        // 3. Pricing calendar — batch upsert
        if (syncPricing) {
          try {
            const days = await getPricingCalendar(guestyId, fmt(today), fmt(sixMonthsOut))
            if (days.length > 0) {
              // Batch in chunks of 500 (Supabase limit)
              for (let j = 0; j < days.length; j += 500) {
                const chunk = days.slice(j, j + 500).map((d: any) => ({
                  property_id: propertyId,
                  calendar_date: d.date,
                  base_rate: d.price ?? null,
                  recommended_rate: d.suggestedPrice ?? d.revenue ?? d.price ?? null,
                  is_available: d.status === 'available',
                  is_blocked: d.status === 'unavailable',
                  block_reason: d.blockReason ?? null,
                  min_stay_nights: d.minNights ?? 2,
                  source: 'guesty',
                  synced_at: new Date().toISOString(),
                }))
                const { error: upsertErr } = await sb.from('pricing_calendar').upsert(chunk, { onConflict: 'property_id,calendar_date' })
                if (upsertErr) results.errors.push(`${property.name} pricing: ${upsertErr.message}`)
                else results.pricing += chunk.length
              }
            }
          } catch (e) {
            results.errors.push(`${property.name} pricing: ${e instanceof Error ? e.message : String(e)}`)
          }
        }

        results.synced++
      } catch (e) {
        results.errors.push(`${property.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }))

    // Small delay between concurrent batches
    if (i + CONCURRENT < properties.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  const hasMore = offset + batchSize < allProperties.length
  const nextOffset = offset + batchSize

  return NextResponse.json({
    success: true,
    ...results,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    nextUrl: hasMore ? `/api/cron/sync-all?secret=nok-sync-2025&offset=${nextOffset}&batch=${batchSize}` : null,
    message: `Batch ${offset}-${offset + properties.length}: Synced ${results.synced}/${properties.length} properties (${results.reservations} reservas, ${results.reviews} reseñas, ${results.pricing} días)`,
  })
}
