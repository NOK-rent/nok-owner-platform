import { NextRequest, NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/server'
import { signOnboardingToken } from '@/lib/onboarding-token'
import FollowupD7 from '@/emails/FollowupD7'
import { cronSkippedInStandalone } from '@/lib/portal-mode'

const FROM = process.env.RESEND_FROM_ADDRESS || 'NOK <noreply@nok.rent>'
const SUPPORT_EMAIL = process.env.NOK_SUPPORT_EMAIL || 'hello@nok.rent'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://nok-owner-platform.vercel.app'
const SCHEDULE_LINK = process.env.NOK_SCHEDULE_LINK || `${APP_URL}/dashboard`

/**
 * D+7 onboarding follow-up cron.
 * Spec: section 3 ("Email de seguimiento — 7 días post-onboarding").
 *
 * Finds owners who received a welcome 7+ days ago, haven't completed setup
 * (no auth.users.last_sign_in_at or no banking details), and haven't yet
 * received the followup_d7.
 *
 * Runs via Vercel Cron or Make scheduler. Gated by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  // Sitio de un edificio (own96.nok.rent): los crons solo corren en owners.nok.rent
  const skipped = cronSkippedInStandalone()
  if (skipped) return skipped
  const secret = req.nextUrl.searchParams.get('secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY missing' }, { status: 500 })
  }

  const sb = createServiceClient()
  const resend = new Resend(process.env.RESEND_API_KEY)

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // Candidates: welcome sent ≥ 7 days ago
  const { data: candidates, error } = await sb
    .from('owner_email_log')
    .select('listing_id, owner_email, created_at, metadata')
    .eq('email_type', 'welcome')
    .eq('status', 'sent')
    .lte('created_at', sevenDaysAgo)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Array<{ email: string; result: string }> = []

  for (const c of candidates || []) {
    // Skip if already followed up
    const { data: already } = await sb
      .from('owner_email_log')
      .select('id')
      .eq('listing_id', c.listing_id)
      .eq('email_type', 'followup_d7')
      .limit(1)
      .maybeSingle()
    if (already) {
      results.push({ email: c.owner_email, result: 'already_sent' })
      continue
    }

    // Check activation: owner has signed in at least once
    let activated = false
    try {
      const { data: userList } = await sb.auth.admin.listUsers()
      const user = userList?.users?.find((u) => u.email?.toLowerCase() === c.owner_email.toLowerCase())
      if (user?.last_sign_in_at) activated = true
    } catch {
      // fail open — don't block followup on activation check
    }
    if (activated) {
      await sb.from('owner_email_log').insert({
        listing_id: c.listing_id,
        owner_email: c.owner_email,
        email_type: 'followup_d7',
        status: 'skipped',
        error_message: 'already activated',
      })
      results.push({ email: c.owner_email, result: 'skipped_activated' })
      continue
    }

    const ownerName = (c.metadata as any)?.ownerName || c.owner_email.split('@')[0]
    const onboardingManager = (c.metadata as any)?.onboardingManager || 'your NOK account manager'
    const token = signOnboardingToken({
      listingId: c.listing_id,
      ownerEmail: c.owner_email,
      purpose: 'portal_access',
    })
    const portalLink = `${APP_URL}/onboarding/access?token=${token}`

    try {
      const { data, error: sendErr } = await resend.emails.send({
        from: FROM,
        to: [c.owner_email],
        subject: "A quick check-in — how's your NOK setup going?",
        react: FollowupD7({
          ownerName,
          onboardingManager,
          portalLinkToken: portalLink,
          scheduleCallLink: SCHEDULE_LINK,
          supportEmail: SUPPORT_EMAIL,
        }),
      })

      if (sendErr) throw new Error(sendErr.message)

      await sb.from('owner_email_log').insert({
        listing_id: c.listing_id,
        owner_email: c.owner_email,
        email_type: 'followup_d7',
        status: 'sent',
        resend_id: data?.id,
      })
      results.push({ email: c.owner_email, result: 'sent' })
    } catch (e: any) {
      await sb.from('owner_email_log').insert({
        listing_id: c.listing_id,
        owner_email: c.owner_email,
        email_type: 'followup_d7',
        status: 'failed',
        error_message: e?.message || 'unknown',
      })
      results.push({ email: c.owner_email, result: `failed: ${e?.message}` })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
