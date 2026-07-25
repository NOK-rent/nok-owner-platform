import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Tipos de evento visibles para el propietario (las notas internas y la clasificación IA no)
const OWNER_VISIBLE_EVENTS = ['owner_message', 'agent_response']

// GET: hilo completo de una conversación del owner
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb
    .from('owners')
    .select('id')
    .eq('supabase_user_id', user.id)
    .single()
  if (!owner) return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })

  const { data: ticket } = await sb
    .from('support_tickets')
    .select('id, title, status, area_responsable, apartamento, urgencia, created_at, updated_at')
    .eq('id', id)
    .eq('owner_id', owner.id)
    .single()
  if (!ticket) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  const { data: events } = await sb
    .from('ticket_events')
    .select('id, event_type, content, metadata, author_name, created_at')
    .eq('ticket_id', id)
    .in('event_type', OWNER_VISIBLE_EVENTS)
    .order('created_at', { ascending: true })

  return NextResponse.json({ ticket, events: events ?? [] })
}
