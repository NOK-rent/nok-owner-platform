import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — must be called before checking session
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Public paths that don't require auth
  const publicPaths = ['/login', '/auth/callback', '/onboarding', '/admin', '/api/onboarding', '/apt-setup', '/api/apt-setup', '/api/sync-reviews', '/api/cron', '/api/owners', '/api/webhooks']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  // Redirect while PRESERVING the auth cookies Supabase just refreshed on
  // `supabaseResponse`. A bare NextResponse.redirect() drops those Set-Cookie
  // headers, so the browser keeps sending a stale/expired session and bounces
  // between /login and /dashboard → ERR_TOO_MANY_REDIRECTS. (Per Supabase SSR docs.)
  const redirectTo = (to: string) => {
    const url = request.nextUrl.clone()
    url.pathname = to
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return res
  }

  if (!user && !isPublic) {
    return redirectTo('/login')
  }

  if (user && pathname === '/login') {
    return redirectTo('/dashboard')
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
