import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createTicketForOwner } from '@/lib/soporte'

export async function POST(req: NextRequest) {
  try {
    // Verify authenticated user
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const sb = createServiceClient()
    const body = await req.json()
    const { propertyId, message } = body

    if (!propertyId || !message?.trim()) {
      return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
    }

    // Get owner and property info
    const { data: owner } = await sb
      .from('owners')
      .select('id, name, email, pais')
      .eq('supabase_user_id', user.id)
      .single()

    if (!owner) {
      return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })
    }

    const { data: property } = await sb
      .from('properties')
      .select('id, name, country')
      .eq('id', propertyId)
      .eq('owner_id', owner.id)
      .single()

    if (!property) {
      return NextResponse.json({ error: 'Propiedad no encontrada' }, { status: 404 })
    }

    // Ticket + clasificación IA + email Resend directo al responsable (cc owners@nok.rent)
    const { ticket, classification } = await createTicketForOwner({
      sb,
      owner,
      property,
      message: message.trim(),
    })

    return NextResponse.json({
      success: true,
      ticketId: ticket.id,
      area: classification.area,
      confianza: classification.confianza,
    })
  } catch (error) {
    console.error('Soporte POST error:', error)
    return NextResponse.json({ error: 'Error creando ticket' }, { status: 500 })
  }
}
