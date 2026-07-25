import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  buildTeamNotificationEmail,
  sendSoporteEmail,
  uploadAttachments,
  OWNERS_INBOX,
  type TicketAttachment,
} from '@/lib/soporte'

// POST: respuesta del owner en un hilo existente (multipart: message + files)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb
    .from('owners')
    .select('id, name, email')
    .eq('supabase_user_id', user.id)
    .single()
  if (!owner) return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })

  const { data: ticket } = await sb
    .from('support_tickets')
    .select('id, title, status, area_responsable, correo_responsable, apartamento, urgencia, email_count')
    .eq('id', id)
    .eq('owner_id', owner.id)
    .single()
  if (!ticket) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  try {
    const form = await req.formData()
    const message = String(form.get('message') || '').trim()
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
    if (!message && !files.length) {
      return NextResponse.json({ error: 'Escribe un mensaje' }, { status: 400 })
    }

    let attachments: TicketAttachment[] = []
    if (files.length) {
      attachments = await uploadAttachments(sb, ticket.id, files)
    }

    const { error: evErr } = await sb.from('ticket_events').insert({
      ticket_id: ticket.id,
      event_type: 'owner_message',
      content: message || '(adjuntos)',
      author_name: owner.name,
      author_email: owner.email,
      metadata: attachments.length ? { attachments } : null,
    })
    if (evErr) throw evErr

    await sb.from('support_tickets').update({
      status: 'open',
      last_owner_message_at: new Date().toISOString(),
      email_count: (ticket.email_count ?? 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', ticket.id)

    // Notificar al responsable del área (cc owners@)
    const email = buildTeamNotificationEmail({
      kind: 'respuesta',
      ticketId: ticket.id,
      titulo: ticket.title,
      area: ticket.area_responsable || 'CX',
      urgencia: ticket.urgencia || 'media',
      ownerName: owner.name,
      apartamento: ticket.apartamento || '',
      message: message || '(el propietario envió adjuntos)',
      attachments,
    })
    await sendSoporteEmail({
      to: ticket.correo_responsable || OWNERS_INBOX,
      cc: OWNERS_INBOX,
      subject: email.subject,
      html: email.html,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('[soporte/reply] error', e)
    return NextResponse.json({ error: e?.message || 'Error enviando la respuesta' }, { status: 500 })
  }
}
