import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/getRequestUser'
import { createAdminClient } from '@/lib/supabase/admin'
import { logActivity } from '@/lib/supabase/activityLog'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const year = new Date().getFullYear()
  const randomBytes = crypto.getRandomValues(new Uint8Array(4))
  const randomPart = Array.from(randomBytes)
    .map(byte => chars[byte % chars.length])
    .join('')
  return `EP-${year}-${randomPart}`
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const user = await getRequestUser()

    if (!user?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Fetch target user for logging
    const { data: targetProfile } = await supabase
      .schema('batchmaker')
      .from('user_profiles')
      .select('display_name, email')
      .eq('id', userId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Gebruiker niet gevonden' }, { status: 404 })
    }

    const tempPassword = generateTempPassword()
    const adminClient = createAdminClient()

    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
    })

    if (updateError) {
      return NextResponse.json({ error: 'Wachtwoord resetten mislukt' }, { status: 500 })
    }

    await logActivity({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      action: 'admin.password_reset',
      module: 'admin',
      description: `Wachtwoord gereset voor ${targetProfile.display_name} (${targetProfile.email})`,
      metadata: { target_user_id: userId },
    })

    return NextResponse.json({
      message: 'Wachtwoord gereset',
      email: targetProfile.email,
      temporary_password: tempPassword,
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Er ging iets mis' }, { status: 500 })
  }
}
