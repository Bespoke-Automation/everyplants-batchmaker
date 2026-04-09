import { NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/supabase/getRequestUser'
import { createAdminClient } from '@/lib/supabase/admin'
import { supabase } from '@/lib/supabase/client'
import { logActivity } from '@/lib/supabase/activityLog'

export const dynamic = 'force-dynamic'

const ALLOWED_FIELDS = [
  'is_admin',
  'module_batchmaker',
  'module_verpakkingsmodule',
  'module_floriday',
  'module_raapmodule',
  'module_bestellijst',
  'module_incidenten',
]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const user = await getRequestUser()

  if (!user?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const body = await request.json()

  // Only allow updating known fields
  const updates: Record<string, boolean> = {}
  for (const field of ALLOWED_FIELDS) {
    if (field in body && typeof body[field] === 'boolean') {
      updates[field] = body[field]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Prevent removing own admin
  if (id === user.id && updates.is_admin === false) {
    return NextResponse.json({ error: 'Cannot remove own admin status' }, { status: 400 })
  }

  const { error } = await supabase
    .schema('batchmaker')
    .from('user_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch updated profile for log
  const { data: targetProfile } = await supabase
    .schema('batchmaker')
    .from('user_profiles')
    .select('display_name, email')
    .eq('id', id)
    .single()

  await logActivity({
    user_id: user.id,
    user_email: user.email,
    user_name: user.name,
    action: 'admin.access_changed',
    module: 'admin',
    description: `Toegang aangepast voor ${targetProfile?.display_name || id}`,
    metadata: { target_user_id: id, changes: updates },
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const user = await getRequestUser()

    if (!user?.is_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    if (user.id === userId) {
      return NextResponse.json({ error: 'Je kunt jezelf niet verwijderen' }, { status: 400 })
    }

    // Fetch target user
    const { data: targetProfile } = await supabase
      .schema('batchmaker')
      .from('user_profiles')
      .select('display_name, email, is_admin')
      .eq('id', userId)
      .single()

    if (!targetProfile) {
      return NextResponse.json({ error: 'Gebruiker niet gevonden' }, { status: 404 })
    }

    // Protect last admin
    if (targetProfile.is_admin) {
      const { count } = await supabase
        .schema('batchmaker')
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('is_admin', true)

      if (count === 1) {
        return NextResponse.json({ error: 'Kan de laatste admin niet verwijderen' }, { status: 400 })
      }
    }

    // Delete auth user (cascades to batchmaker profile via FK)
    const adminClient = createAdminClient()

    // First delete batchmaker profile (no FK cascade from auth)
    await adminClient
      .schema('batchmaker')
      .from('user_profiles')
      .delete()
      .eq('id', userId)

    // Then delete auth user
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)
    if (deleteError) {
      return NextResponse.json({ error: 'Verwijderen mislukt' }, { status: 500 })
    }

    await logActivity({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      action: 'admin.user_deleted',
      module: 'admin',
      description: `Gebruiker verwijderd: ${targetProfile.display_name} (${targetProfile.email})`,
      metadata: { deleted_user_id: userId },
    })

    return NextResponse.json({ message: 'Gebruiker verwijderd' })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json({ error: 'Er ging iets mis' }, { status: 500 })
  }
}

