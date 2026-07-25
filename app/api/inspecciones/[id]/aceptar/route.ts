import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendSoporteEmail, OWNERS_INBOX } from '@/lib/soporte'

// POST: el owner acepta la inspección desde su portal → aviso al equipo NOK.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id, name, email').eq('supabase_user_id', user.id).single()
  if (!owner) return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })

  const { data: item } = await sb
    .from('owner_work_items')
    .select('id, titulo, status, tipo, valor_usd, properties(name)')
    .eq('id', id)
    .eq('owner_id', owner.id)
    .single()
  if (!item) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  if (item.status !== 'enviada') return NextResponse.json({ error: 'Esta inspección ya fue gestionada' }, { status: 400 })

  const nowIso = new Date().toISOString()
  const { error } = await sb.from('owner_work_items')
    .update({ status: 'aceptada', aceptada_at: nowIso, updated_at: nowIso })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aviso al equipo: ya se puede realizar
  const propertyName = (item as any).properties?.name || ''
  await sendSoporteEmail({
    to: OWNERS_INBOX,
    subject: `✅ Inspección ACEPTADA: ${item.titulo} · ${propertyName}`,
    html: `
<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1A1A1A;">
  <p><b>${owner.name}</b> (${owner.email}) aceptó la inspección desde su portal.</p>
  <p><b>${item.titulo}</b> · ${propertyName}${item.valor_usd != null ? ` · USD ${item.valor_usd}` : ''}</p>
  <p>Ya se puede programar la fecha del mantenimiento desde el hub → Soporte → Inspecciones.</p>
</div>`,
  })

  return NextResponse.json({ ok: true })
}
