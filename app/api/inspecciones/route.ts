import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// GET: inspecciones e incidencias del owner logueado (para la pestaña Equipo NOK)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const sb = createServiceClient() as any
  const { data: owner } = await sb.from('owners').select('id').eq('supabase_user_id', user.id).single()
  if (!owner) return NextResponse.json({ error: 'Propietario no encontrado' }, { status: 404 })

  const { data, error } = await sb
    .from('owner_work_items')
    .select('id, tipo, titulo, descripcion, valor_usd, pdf_url, fotos, status, fecha_programada, created_at, properties(name)')
    .eq('owner_id', owner.id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
