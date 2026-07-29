import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccessToken } from '@/lib/guesty'

export const runtime = 'nodejs'
export const maxDuration = 60

const GUESTY = process.env.GUESTY_BASE_URL || 'https://open-api.guesty.com/v1'
const OWNERS_INBOX = process.env.OWNERS_INBOX_EMAIL || 'owners@nok.rent'
const NOTIFY = [OWNERS_INBOX, 'mam@nok.rent', 'cg@nok.rent']
const FROM = process.env.SOPORTE_FROM_ADDRESS || 'NOK Owners <owners@nok.rent>'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * POST — el propietario bloquea fechas desde su calendario.
 * body: { propertyId, startDate, endDate (inclusive), para: 'propietario'|'familiar',
 *         huespedNombre?, horaLlegada, horaSalida }
 * 1) valida que la propiedad es del owner
 * 2) valida que NO haya reserva que solape el rango (cache reservations)
 * 3) crea el bloqueo en Guesty (unavailable, nota "Bloqueo del propietario")
 * 4) guarda en owner_calendar_blocks
 * 5) email a owners@ + mam@ + cg@nok.rent
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, name, email').eq('supabase_user_id', user.id).single()
  if (!owner) return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })

  try {
    const body = await req.json()
    const propertyId = String(body.propertyId || '')
    const startDate = String(body.startDate || '')
    const endDate = String(body.endDate || '')  // inclusive: última noche
    const para = body.para === 'familiar' ? 'familiar' : 'propietario'
    const huespedNombre = body.huespedNombre ? String(body.huespedNombre).trim() : null
    const horaLlegada = String(body.horaLlegada || '').trim()
    const horaSalida = String(body.horaSalida || '').trim()

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
      return NextResponse.json({ error: 'Fechas inválidas' }, { status: 400 })
    }
    const todayIso = new Date().toISOString().slice(0, 10)
    if (startDate < todayIso) return NextResponse.json({ error: 'No puedes bloquear fechas pasadas' }, { status: 400 })
    if (!horaLlegada || !horaSalida) return NextResponse.json({ error: 'Indica hora de llegada y de salida' }, { status: 400 })

    // 1) La propiedad es del owner
    const { data: property } = await sb
      .from('properties')
      .select('id, name, guesty_listing_id')
      .eq('id', propertyId)
      .eq('owner_id', owner.id)
      .single()
    if (!property) return NextResponse.json({ error: 'Propiedad no encontrada' }, { status: 404 })
    if (!property.guesty_listing_id) return NextResponse.json({ error: 'Esta propiedad no está conectada a Guesty; escríbenos para bloquearla.' }, { status: 400 })

    // 2) Sin reservas que solapen [startDate, endDate] (una reserva ocupa check_in..check_out-1)
    const { data: overlaps } = await sb
      .from('reservations')
      .select('guest_name, check_in, check_out')
      .eq('property_id', propertyId)
      .in('status', ['confirmed', 'checked_in', 'checked_out'])
      .lte('check_in', endDate)     // empieza antes o el mismo día del fin del bloqueo
      .gt('check_out', startDate)   // termina después del inicio del bloqueo
    if (overlaps && overlaps.length) {
      const r = overlaps[0]
      return NextResponse.json({
        error: `No se puede bloquear: ya hay una reserva (${r.guest_name || 'huésped'}, ${r.check_in} → ${r.check_out}) en esas fechas.`,
      }, { status: 409 })
    }

    // 3) Bloqueo en Guesty
    const token = await getAccessToken()
    const gRes = await fetch(`${GUESTY}/availability-pricing/api/calendar/listings/${property.guesty_listing_id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ startDate, endDate, status: 'unavailable', note: `Bloqueo del propietario (${para})` }),
    })
    const guestyOk = gRes.ok
    if (!guestyOk) {
      const t = await gRes.text().catch(() => '')
      console.error('[calendar/block] guesty error', gRes.status, t)
      return NextResponse.json({ error: 'No se pudo aplicar el bloqueo en el calendario. Intenta de nuevo o escríbenos.' }, { status: 502 })
    }

    // 4) Persistir
    const { data: block } = await sb.from('owner_calendar_blocks').insert({
      property_id: property.id,
      owner_id: owner.id,
      guesty_listing_id: property.guesty_listing_id,
      start_date: startDate,
      end_date: endDate,
      para,
      huesped_nombre: huespedNombre,
      hora_llegada: horaLlegada,
      hora_salida: horaSalida,
      guesty_ok: true,
    }).select('id').single()

    // 5) Email al equipo NOK
    const html = `
<div style="background:#F0EFED;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid rgba(26,26,26,0.08);">
    <div style="padding:24px 32px;border-bottom:1px solid rgba(26,26,26,0.06);">
      <span style="font-size:20px;letter-spacing:6px;color:#1A1A1A;font-weight:bold;">NOK</span>
    </div>
    <div style="padding:28px 32px;color:#1A1A1A;font-size:14px;line-height:1.6;">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#833B0E;">Bloqueo de calendario por el propietario</p>
      <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;">${esc(property.name)}</h2>
      <table style="font-size:13px;color:#555;" cellpadding="3">
        <tr><td style="color:#9A9A9A;padding-right:12px;">Propietario</td><td>${esc(owner.name || '')} (${esc(owner.email || '')})</td></tr>
        <tr><td style="color:#9A9A9A;padding-right:12px;">Fechas</td><td><b>${startDate} → ${endDate}</b> (última noche ${endDate})</td></tr>
        <tr><td style="color:#9A9A9A;padding-right:12px;">Para</td><td>${para === 'familiar' ? 'Un familiar' : 'El propietario'}${huespedNombre ? ` — ${esc(huespedNombre)}` : ''}</td></tr>
        <tr><td style="color:#9A9A9A;padding-right:12px;">Llegada / salida</td><td>${esc(horaLlegada)} → ${esc(horaSalida)}</td></tr>
      </table>
      <div style="margin-top:14px;background:#F0EFED;border-radius:12px;padding:14px;font-size:13px;">
        El bloqueo ya quedó aplicado en el calendario de Guesty como <b>bloqueo del propietario</b>. No requiere acción, es solo aviso.
      </div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid rgba(26,26,26,0.06);font-size:11px;color:#9A9A9A;">NOK · owners.nok.rent</div>
  </div>
</div>`
    try {
      const key = process.env.RESEND_API_KEY
      if (key) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ from: FROM, to: NOTIFY, reply_to: owner.email || OWNERS_INBOX, subject: `🔒 Bloqueo del propietario · ${property.name} · ${startDate}→${endDate}`, html }),
        })
      }
    } catch (e) { console.error('[calendar/block] email error', e) }

    return NextResponse.json({ ok: true, blockId: block?.id })
  } catch (err) {
    console.error('[calendar/block] error', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
