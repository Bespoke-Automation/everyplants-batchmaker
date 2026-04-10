import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request })

  const isLoginPage = request.nextUrl.pathname === '/login'
  const isApiRoute = request.nextUrl.pathname.startsWith('/api')

  // API routes pass through (Inngest uses signing keys, others are internal)
  if (isApiRoute) return response

  // Login page: clear stale auth cookies to prevent browser-side refresh token spam
  if (isLoginPage) {
    const cookieNames = request.cookies.getAll().map(c => c.name).filter(n => n.startsWith('sb-'))
    for (const name of cookieNames) {
      response.cookies.delete(name)
    }
    return response
  }

  const supabase = createMiddlewareClient(request, response)

  // Refresh session — critical for SSR auth cookie management
  const { data: { user } } = await supabase.auth.getUser()

  // Redirect authenticated user away from login
  if (user) return response

  // Redirect to login if not authenticated
  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
