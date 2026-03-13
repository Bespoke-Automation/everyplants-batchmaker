import { createAuthClient } from './server'

export async function getRequestUser() {
  try {
    const supabase = await createAuthClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const { data: profile } = await supabase
      .schema('batchmaker')
      .from('user_profiles')
      .select('display_name, email, is_admin')
      .eq('id', user.id)
      .single()

    return {
      id: user.id,
      email: user.email || profile?.email || 'unknown',
      name: profile?.display_name || 'unknown',
      is_admin: profile?.is_admin || false,
    }
  } catch {
    return null
  }
}
