import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createAuthClient()

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/login?error=invalid_code', request.url))
  }

  return NextResponse.redirect(new URL('/nieuw-wachtwoord', request.url))
}
