/**
 * GET /api/edificio/[configId]/pnl?year=YYYY
 *
 * P&L del edificio (net-commission). Fuente única para el portal y para la
 * "Vista propietario" de nok-hub (/edificios), que llama con ?secret= (M2M).
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/admin'
import { computeBuildingPnl } from '@/lib/building-pnl'
import { hasValidMachineSecret, resolveBuilding, resolveBuildingUnauthenticated } from '@/lib/edificio'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request, ctx: { params: Promise<{ configId: string }> }) {
  const { configId } = await ctx.params
  const { searchParams } = new URL(req.url)
  const yearRaw = Number(searchParams.get('year'))
  const year = Number.isInteger(yearRaw) && yearRaw >= 2020 && yearRaw <= 2100 ? yearRaw : new Date().getFullYear()

  const sb = createServiceClient() as any
  let resolved: Awaited<ReturnType<typeof resolveBuilding>> = null
  const isMachine = hasValidMachineSecret(req)

  if (isMachine) {
    resolved = await resolveBuildingUnauthenticated(sb, configId)
  } else {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const { data: owner } = await sb.from('owners').select('id, email, additional_emails').eq('supabase_user_id', user.id).single()
    if (!owner) return NextResponse.json({ error: 'no owner' }, { status: 403 })
    resolved = await resolveBuilding(sb, configId, owner, isAdminEmail(owner.email))
    if (!resolved) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!resolved) return NextResponse.json({ error: 'not found' }, { status: 404 })

  try {
    const pnl = await computeBuildingPnl(sb, resolved.config, resolved.properties, year)
    if (!isMachine) {
      // Al propietario (sesión) no se le exponen rutas de storage ni emails del equipo:
      // las facturas se firman en la página de Costos. Solo el hub (M2M) recibe el detalle.
      for (const lines of Object.values(pnl.costLines)) {
        for (const l of lines) {
          ;(l as any).attachmentCount = Array.isArray(l.attachments) ? l.attachments.length : 0
          delete (l as any).attachments
          delete (l as any).created_by
        }
      }
    }
    return NextResponse.json(pnl, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[edificio/pnl]', err)
    return NextResponse.json({ error: 'No se pudo calcular el P&L' }, { status: 500 })
  }
}
