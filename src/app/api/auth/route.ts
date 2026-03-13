import { NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE() {
  const supabase = await createAuthClient()
  await supabase.auth.signOut()
  return NextResponse.json({ success: true })
}
