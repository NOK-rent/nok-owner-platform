import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST { locale: 'es'|'en' } — persiste el idioma del owner (DB + cookie).
// Los emails transaccionales se envían en este idioma.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { locale } = await req.json().catch(() => ({}))
  if (locale !== 'es' && locale !== 'en') {
    return NextResponse.json({ error: 'locale inválido' }, { status: 400 })
  }

  const sb = createServiceClient() as any
  await sb.from('owners').update({ locale }).eq('supabase_user_id', user.id)

  const res = NextResponse.json({ ok: true, locale })
  res.cookies.set('nok_locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  return res
}
