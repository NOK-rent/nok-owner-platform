/**
 * GET /api/cron/sync-orchestrator?secret=nok-sync-2025
 *
 * Orchestrates the full sync by calling /api/cron/sync-all in batches.
 * Each batch syncs 15 properties. Keeps calling until all are done.
 * This is the endpoint that Vercel Cron should call daily.
 */

import { NextResponse } from 'next/server'
import { cronSkippedInStandalone } from '@/lib/portal-mode'

export const maxDuration = 300

export async function GET(req: Request) {
  // Sitio de un edificio (own96.nok.rent): los crons solo corren en owners.nok.rent
  const skipped = cronSkippedInStandalone()
  if (skipped) return skipped
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== 'nok-sync-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the base URL from the request
  const url = new URL(req.url)
  const baseUrl = `${url.protocol}//${url.host}`

  const BATCH_SIZE = 15
  let offset = 0
  let totalSynced = 0
  let totalReservations = 0
  let totalReviews = 0
  let totalPricing = 0
  const allErrors: string[] = []
  let totalProperties = 0

  // Keep calling sync-all until done or we run out of time
  const startTime = Date.now()
  const MAX_RUNTIME = 270_000 // 4.5 minutes (leave buffer for the 5 min limit)

  while (true) {
    if (Date.now() - startTime > MAX_RUNTIME) {
      allErrors.push(`Stopped at offset ${offset} due to time limit`)
      break
    }

    try {
      const batchUrl = `${baseUrl}/api/cron/sync-all?secret=nok-sync-2025&offset=${offset}&batch=${BATCH_SIZE}`
      const res = await fetch(batchUrl)
      const data = await res.json()

      if (!data.success) {
        allErrors.push(`Batch at offset ${offset}: ${data.error}`)
        break
      }

      totalProperties = data.totalProperties
      totalSynced += data.synced ?? 0
      totalReservations += data.reservations ?? 0
      totalReviews += data.reviews ?? 0
      totalPricing += data.pricing ?? 0
      if (data.errors?.length) allErrors.push(...data.errors)

      if (!data.hasMore || data.done) break

      offset = data.nextOffset
    } catch (e) {
      allErrors.push(`Batch at offset ${offset}: ${e instanceof Error ? e.message : String(e)}`)
      break
    }
  }

  return NextResponse.json({
    success: true,
    totalProperties,
    totalSynced,
    totalReservations,
    totalReviews,
    totalPricing,
    errors: allErrors.slice(0, 20), // Cap errors to prevent huge response
    message: `Full sync: ${totalSynced}/${totalProperties} properties synced (${totalReservations} reservas, ${totalReviews} reseñas, ${totalPricing} días)`,
  })
}
