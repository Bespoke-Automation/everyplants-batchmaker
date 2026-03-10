import { supabase } from './client'

export interface VervoerderShippingProfile {
  id: string
  vervoerder_id: string
  shipping_profile_id: number
  profile_name: string
  carrier: string | null
}

export interface Vervoerder {
  id: string
  name: string
  created_at: string
  profiles: VervoerderShippingProfile[]
}

export async function getVervoerders(): Promise<Vervoerder[]> {
  const { data: vervoerders, error } = await supabase
    .schema('batchmaker')
    .from('vervoerders')
    .select('id, name, created_at')
    .order('name')

  if (error) {
    console.error('Error fetching vervoerders:', error)
    throw error
  }

  if (!vervoerders || vervoerders.length === 0) return []

  const { data: profiles, error: profilesError } = await supabase
    .schema('batchmaker')
    .from('vervoerder_shipping_profiles')
    .select('id, vervoerder_id, shipping_profile_id, profile_name, carrier')

  if (profilesError) {
    console.error('Error fetching vervoerder profiles:', profilesError)
    throw profilesError
  }

  return vervoerders.map(v => ({
    ...v,
    profiles: (profiles || []).filter(p => p.vervoerder_id === v.id),
  }))
}

export async function createVervoerder(name: string): Promise<Vervoerder> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('vervoerders')
    .insert({ name })
    .select('id, name, created_at')
    .single()

  if (error) {
    console.error('Error creating vervoerder:', error)
    throw error
  }

  return { ...data, profiles: [] }
}

export async function deleteVervoerder(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('vervoerders')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting vervoerder:', error)
    throw error
  }
}

export async function addShippingProfile(
  vervoerderId: string,
  profile: { shipping_profile_id: number; profile_name: string; carrier?: string }
): Promise<VervoerderShippingProfile> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('vervoerder_shipping_profiles')
    .insert({
      vervoerder_id: vervoerderId,
      shipping_profile_id: profile.shipping_profile_id,
      profile_name: profile.profile_name,
      carrier: profile.carrier || null,
    })
    .select('id, vervoerder_id, shipping_profile_id, profile_name, carrier')
    .single()

  if (error) {
    console.error('Error adding shipping profile:', error)
    throw error
  }

  return data
}

export async function addShippingProfiles(
  vervoerderId: string,
  profiles: { shipping_profile_id: number; profile_name: string; carrier?: string }[]
): Promise<VervoerderShippingProfile[]> {
  if (profiles.length === 0) return []

  const rows = profiles.map(p => ({
    vervoerder_id: vervoerderId,
    shipping_profile_id: p.shipping_profile_id,
    profile_name: p.profile_name,
    carrier: p.carrier || null,
  }))

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('vervoerder_shipping_profiles')
    .insert(rows)
    .select('id, vervoerder_id, shipping_profile_id, profile_name, carrier')

  if (error) {
    console.error('Error adding shipping profiles:', error)
    throw error
  }

  return data || []
}

export async function removeShippingProfile(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('vervoerder_shipping_profiles')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error removing shipping profile:', error)
    throw error
  }
}
