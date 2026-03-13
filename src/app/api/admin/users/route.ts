import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/getRequestUser'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getRequestUser()
  if (!user?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: profiles, error } = await supabase
    .schema('batchmaker')
    .from('user_profiles')
    .select('*')
    .order('display_name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ profiles })
}
