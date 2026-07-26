/**
 * GET /api/cron/milestone-digest?secret=nok-sync-2025
 *
 * Daily positive-milestone digest for owners: new bookings and great reviews
 * from the last 24h, one email per owner (only if there is something to tell).
 *
 * SAFE MODE: until MILESTONE_DIGEST_LIVE=true is set in the environment, all
 * emails are sent to NOK (se@nok.rent) with the intended recipient in the
 * subject, so the copy can be validated before going live to real owners.
 */

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fxToUSD } from '@/lib/wheelhouse'

export const maxDuration = 120

const FROM = 'NOK Owners <owners@nok.rent>'
const PREVIEW_TO = 'se@nok.rent'

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  return res.ok
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== 'nok-sync-2025') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const live = process.env.MILESTONE_DIGEST_LIVE === 'true'
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const sb = createServiceClient() as any

  const [bookingsRes, reviewsRes, ownersRes, propsRes] = await Promise.all([
    sb.from('reservations')
      .select('property_id, guest_name, nights, owner_revenue, total_price, currency, check_in, channel, guesty_created_at')
      .in('status', ['confirmed', 'checked_in'])
      .eq('is_blocked', false)
      .gte('guesty_created_at', since),
    sb.from('reviews')
      .select('property_id, overall_score, guest_name, reviewer_text, submitted_at')
      .gte('submitted_at', since)
      .gte('overall_score', 4.5),
    sb.from('owners').select('id, name, email, supabase_user_id').not('supabase_user_id', 'is', null),
    sb.from('properties').select('id, name, owner_id').not('owner_id', 'is', null),
  ])

  const propById = new Map<string, any>((propsRes.data ?? []).map((p: any) => [p.id, p]))
  const byOwner = new Map<string, { bookings: any[]; reviews: any[] }>()
  const add = (ownerId: string) => {
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, { bookings: [], reviews: [] })
    return byOwner.get(ownerId)!
  }
  for (const b of bookingsRes.data ?? []) {
    const p = propById.get(b.property_id)
    if (p?.owner_id) add(p.owner_id).bookings.push({ ...b, propertyName: p.name })
  }
  for (const r of reviewsRes.data ?? []) {
    const p = propById.get(r.property_id)
    if (p?.owner_id) add(p.owner_id).reviews.push({ ...r, propertyName: p.name })
  }

  let sent = 0
  for (const o of ownersRes.data ?? []) {
    const items = byOwner.get(o.id)
    if (!items || (items.bookings.length === 0 && items.reviews.length === 0)) continue

    const rows: string[] = []
    for (const b of items.bookings) {
      const amount = Math.round(await fxToUSD(b.owner_revenue ?? b.total_price ?? 0, b.currency || 'USD'))
      rows.push(`<tr><td style="padding:10px 0;border-bottom:1px solid #eee;">
        <strong style="color:#0E6845;">✓ Nueva reserva</strong> — ${b.propertyName}<br>
        <span style="color:#555;font-size:13px;">${b.nights} noche${b.nights === 1 ? '' : 's'} · $${amount.toLocaleString('en-US')} USD · check-in ${b.check_in}${b.channel ? ` · ${b.channel}` : ''}</span>
      </td></tr>`)
    }
    for (const r of items.reviews) {
      rows.push(`<tr><td style="padding:10px 0;border-bottom:1px solid #eee;">
        <strong style="color:#D6A700;">★ Reseña ${Number(r.overall_score).toFixed(1)}/5</strong> — ${r.propertyName}<br>
        <span style="color:#555;font-size:13px;">${(r.reviewer_text ?? '').slice(0, 160)}</span>
      </td></tr>`)
    }

    const firstName = (o.name ?? '').split(' ')[0] || 'Hola'
    const html = `
      <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1A1A1A;">
        <p style="letter-spacing:0.2em;font-size:20px;margin:24px 0 4px;">NOK</p>
        <p style="font-size:15px;color:#555;">Hola ${firstName}, buenas noticias de tus propiedades:</p>
        <table style="width:100%;border-collapse:collapse;">${rows.join('')}</table>
        <p style="margin-top:24px;"><a href="https://owners.nok.rent" style="color:#833B0E;">Ver todo en tu portal →</a></p>
        <p style="font-size:12px;color:#999;margin-top:24px;">NOK Owners · Curated stays designed to flow with you</p>
      </div>`

    const subject = live
      ? `Buenas noticias de tus propiedades · NOK`
      : `[PREVIEW → ${o.email}] Buenas noticias de tus propiedades · NOK`
    const ok = await sendEmail(live ? o.email : PREVIEW_TO, subject, html)
    if (ok) sent++
    await new Promise(r => setTimeout(r, 600)) // Resend allows ~2 req/s
  }

  return NextResponse.json({ live, ownersWithNews: byOwner.size, sent })
}
