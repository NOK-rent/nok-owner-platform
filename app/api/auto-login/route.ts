/**
 * GET /api/auto-login?next=/dashboard
 *
 * Sitio de edificio SIN login (pedido de Santi para own96.nok.rent): inicia
 * sesión automáticamente con la cuenta "visor" del edificio
 * (PORTAL_VIEWER_EMAIL / PORTAL_VIEWER_PASSWORD) y redirige. Solo existe en
 * modo standalone con esas env configuradas; en owners.nok.rent responde 404.
 *
 * Opcional: PORTAL_ACCESS_KEY — si está definida, la primera visita debe traer
 * ?k=<clave> (queda en cookie 1 año); sin clave correcta → 403.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isStandalone } from '@/lib/portal-mode'

export const dynamic = 'force-dynamic'

const KEY_COOKIE = 'nok_portal_key'

export async function GET(req: NextRequest) {
  const email = process.env.PORTAL_VIEWER_EMAIL
  const password = process.env.PORTAL_VIEWER_PASSWORD
  if (!isStandalone() || !email || !password) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const accessKey = process.env.PORTAL_ACCESS_KEY
  const url = req.nextUrl
  const nextRaw = url.searchParams.get('next') || '/dashboard'
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : '/dashboard'

  let keyOk = !accessKey
  if (accessKey) {
    const fromQuery = url.searchParams.get('k')
    const fromCookie = req.cookies.get(KEY_COOKIE)?.value
    keyOk = fromQuery === accessKey || fromCookie === accessKey
    if (!keyOk) return new NextResponse('Acceso restringido. Usa el link completo que te compartió NOK.', { status: 403 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('[auto-login]', error.message)
    return new NextResponse('No se pudo iniciar la sesión del portal. Escríbenos a owners@nok.rent.', { status: 500 })
  }

  const res = NextResponse.redirect(new URL(next, url.origin))
  if (accessKey) res.cookies.set(KEY_COOKIE, accessKey, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: true })
  return res
}
