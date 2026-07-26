/**
 * POST /api/strategy/preview
 * Body: { propertyId: string, adjustmentPct: number }
 *
 * What-if simulator for the Strategy tab: previews the unit's price
 * recommendations under a different positioning (base price adjustment)
 * WITHOUT saving anything. Auth mirrors the dashboard pages: the requesting
 * user must own the property (or be an admin).
 */

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { previewPositioning, resolveWheelhouseRef } from '@/lib/wheelhouse'

export const maxDuration = 30

export async function POST(req: Request) {
  const { propertyId, adjustmentPct } = await req.json().catch(() => ({}))
  if (typeof propertyId !== 'string' || typeof adjustmentPct !== 'number' || !Number.isFinite(adjustmentPct)) {
    return NextResponse.json({ error: 'propertyId y adjustmentPct son requeridos' }, { status: 400 })
  }
  const pct = Math.max(-30, Math.min(30, Math.round(adjustmentPct)))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, email').eq('supabase_user_id', user.id).single()
  if (!owner) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let q = sb.from('properties').select('id, guesty_listing_id, wheelhouse_property_id').eq('id', propertyId)
  if (!isAdminEmail(owner.email)) q = q.eq('owner_id', owner.id)
  const { data: property } = await q.single()
  if (!property) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ref = resolveWheelhouseRef(property)
  if (!ref) return NextResponse.json({ error: 'not_configured' }, { status: 404 })

  const result = await previewPositioning(ref.id, ref.channel, pct)
  if (!result) return NextResponse.json({ error: 'unavailable' }, { status: 502 })

  return NextResponse.json({ pct, ...result })
}
