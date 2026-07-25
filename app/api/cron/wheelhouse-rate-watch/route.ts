/**
 * GET /api/cron/wheelhouse-rate-watch?secret=nok-sync-2025
 *
 * Daily rate-change watcher. For every owner-assigned property connected to
 * Revenue Management, it pulls the freshly posted price calendar, diffs it
 * against yesterday's snapshot and records each changed night as an event.
 * Those events feed the "Cambios recientes de tarifa" feed in the Strategy tab.
 *
 * Paced at ~1 request/second to stay under the RM API 60 req/min limit.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLastPostedMap, resolveWheelhouseRef } from '@/lib/wheelhouse'

export const maxDuration = 300

const HORIZON_DAYS = 180      // only watch nights within this window
const MIN_DELTA = 1           // ignore sub-$1 noise

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== 'nok-sync-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = createServiceClient() as any
  const { data: props } = await sb
    .from('properties')
    .select('id, guesty_listing_id, wheelhouse_property_id')
    .not('owner_id', 'is', null)

  // Stalest-first: properties without a snapshot, then oldest snapshot.
  // A single run may not cover the whole portfolio within maxDuration, so
  // this ordering guarantees full rotation across the twice-daily runs.
  const { data: snaps } = await sb.from('rate_snapshots').select('property_id, taken_at')
  const takenAt = new Map<string, string>((snaps ?? []).map((s: any) => [s.property_id, s.taken_at]))
  ;(props ?? []).sort((a: any, b: any) => {
    const ta = takenAt.get(a.id) ?? ''
    const tb = takenAt.get(b.id) ?? ''
    return ta.localeCompare(tb)
  })

  const today = new Date().toISOString().slice(0, 10)
  const maxDate = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString().slice(0, 10)

  let watched = 0
  let changes = 0
  let baselines = 0
  const startedAt = Date.now()

  for (const p of props ?? []) {
    // Leave headroom before Vercel's maxDuration kills us mid-write
    if (Date.now() - startedAt > 270_000) break

    const ref = resolveWheelhouseRef(p)
    if (!ref) continue

    const fresh = await getLastPostedMap(ref.id, ref.channel)
    await new Promise(r => setTimeout(r, 1100))
    if (!fresh) continue

    const prices: Record<string, number> = {}
    for (const [d, v] of Object.entries(fresh)) {
      if (d >= today && d <= maxDate) prices[d] = v
    }
    watched++

    const { data: snap } = await sb
      .from('rate_snapshots')
      .select('prices')
      .eq('property_id', p.id)
      .maybeSingle()

    if (snap?.prices) {
      const events = []
      for (const [d, newPrice] of Object.entries(prices)) {
        const oldPrice = snap.prices[d]
        if (typeof oldPrice === 'number' && Math.abs(oldPrice - (newPrice as number)) >= MIN_DELTA) {
          events.push({ property_id: p.id, stay_date: d, old_price: oldPrice, new_price: newPrice })
        }
      }
      if (events.length) {
        await sb.from('rate_change_events').insert(events)
        changes += events.length
      }
    } else {
      baselines++
    }

    await sb.from('rate_snapshots').upsert({ property_id: p.id, prices, taken_at: new Date().toISOString() })
  }

  return NextResponse.json({ watched, changes, baselines, tookMs: Date.now() - startedAt })
}
