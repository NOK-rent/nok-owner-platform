import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createTicketForOwner, uploadAttachments, type TicketAttachment } from '@/lib/soporte'

async function requireOwner() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }

  const sb = createServiceClient() as any
  const { data: owner } = await sb
    .from('owners')
    .select('id, name, email, pais')
    .eq('supabase_user_id', user.id)
    .single()
  if (!owner) return { error: NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 }) }
  return { sb, owner }
}

// GET: lista de conversaciones del owner (para la pestaña Equipo NOK)
export async function GET() {
  const ctx = await requireOwner()
  if ('error' in ctx) return ctx.error
  const { sb, owner } = ctx

  const { data: tickets, error } = await sb
    .from('support_tickets')
    .select('id, title, status, area_responsable, apartamento, property_id, urgencia, created_at, updated_at, last_owner_message_at, last_team_message_at')
    .eq('owner_id', owner.id)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ tickets: tickets ?? [] })
}

// POST: nueva conversación desde la pestaña Equipo NOK (multipart, con adjuntos)
export async function POST(req: NextRequest) {
  const ctx = await requireOwner()
  if ('error' in ctx) return ctx.error
  const { sb, owner } = ctx

  try {
    const form = await req.formData()
    const propertyId = String(form.get('propertyId') || '')
    const message = String(form.get('message') || '').trim()
    const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)

    if (!propertyId || !message) {
      return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
    }

    const { data: property } = await sb
      .from('properties')
      .select('id, name, country')
      .eq('id', propertyId)
      .eq('owner_id', owner.id)
      .single()
    if (!property) return NextResponse.json({ error: 'Propiedad no encontrada' }, { status: 404 })

    // Subir adjuntos con un id temporal de carpeta basado en timestamp del owner
    let attachments: TicketAttachment[] = []
    if (files.length) {
      attachments = await uploadAttachments(sb, `pre-${owner.id}-${Date.now()}`, files)
    }

    const { ticket, classification } = await createTicketForOwner({
      sb, owner, property, message, attachments,
    })

    return NextResponse.json({ success: true, ticketId: ticket.id, area: classification.area })
  } catch (e: any) {
    console.error('[soporte/tickets] POST error', e)
    return NextResponse.json({ error: e?.message || 'Error creando la consulta' }, { status: 500 })
  }
}
