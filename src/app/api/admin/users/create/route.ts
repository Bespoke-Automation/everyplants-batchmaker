import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/getRequestUser'
import { createAdminClient } from '@/lib/supabase/admin'

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

export async function POST(request: Request) {
  try {
    const user = await getRequestUser()
    if (!user?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { email, display_name } = await request.json()

    if (!email || !display_name) {
      return NextResponse.json({ error: 'Email en naam zijn verplicht' }, { status: 400 })
    }

    const supabaseAdmin = createAdminClient()

    // Check if user already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    if (existingUsers?.users?.some(u => u.email === email)) {
      return NextResponse.json({ error: 'Een gebruiker met dit e-mailadres bestaat al' }, { status: 400 })
    }

    const tempPassword = generateTempPassword()

    // Trigger `batchmaker.handle_new_user()` auto-creates a profile row on auth.users INSERT,
    // so we pass the display_name as `name` in user_metadata (that's what the trigger reads).
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: display_name },
    })

    if (createError || !newUser.user) {
      return NextResponse.json({ error: createError?.message || 'Gebruiker aanmaken mislukt' }, { status: 400 })
    }

    // Profile was auto-created by trigger — update with extra fields
    const { error: profileError } = await supabaseAdmin
      .schema('batchmaker')
      .from('user_profiles')
      .update({
        invited_by: user.id,
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      })
      .eq('id', newUser.user.id)

    if (profileError) {
      console.error('Profile update error:', profileError)
    }

    return NextResponse.json({
      message: 'Gebruiker aangemaakt',
      user_id: newUser.user.id,
      email,
      temporary_password: tempPassword,
    })
  } catch (error) {
    console.error('Create user error:', error)
    return NextResponse.json({ error: 'Er ging iets mis' }, { status: 500 })
  }
}
