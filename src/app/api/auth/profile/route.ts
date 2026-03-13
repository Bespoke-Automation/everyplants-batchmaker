import { NextResponse } from 'next/server'
import { createAuthClient } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const authClient = await createAuthClient()
    const { data: { user }, error } = await authClient.auth.getUser()

    if (error || !user) {
      return NextResponse.json({ profile: null })
    }

    const { data: profile } = await supabase
      .schema('batchmaker')
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ profile: null })
  }
}
