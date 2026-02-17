import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TagPackagingMap {
  id: string
  tag_title: string
  picqer_packaging_id: number
  packaging_name: string
  is_active: boolean
  created_at: string
  updated_at: string
}

// ── CRUD operations ──────────────────────────────────────────────────────────

/**
 * Get all tag-to-packaging mappings
 */
export async function getTagMappings(): Promise<TagPackagingMap[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .select()
    .order('tag_title', { ascending: true })

  if (error) {
    console.error('Error fetching tag mappings:', error)
    throw error
  }

  return data || []
}

/**
 * Create a new tag-to-packaging mapping
 */
export async function createTagMapping(input: {
  tag_title: string
  picqer_packaging_id: number
  packaging_name: string
  is_active?: boolean
}): Promise<TagPackagingMap> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .insert({
      tag_title: input.tag_title,
      picqer_packaging_id: input.picqer_packaging_id,
      packaging_name: input.packaging_name,
      is_active: input.is_active ?? true,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating tag mapping:', error)
    throw error
  }

  return data
}

/**
 * Update a tag-to-packaging mapping
 */
export async function updateTagMapping(
  id: string,
  updates: Partial<Omit<TagPackagingMap, 'id' | 'created_at' | 'updated_at'>>
): Promise<TagPackagingMap> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating tag mapping:', error)
    throw error
  }

  return data
}

/**
 * Delete a tag-to-packaging mapping
 */
export async function deleteTagMapping(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting tag mapping:', error)
    throw error
  }
}

/**
 * Get tag mapping by picqer_packaging_id
 */
export async function getTagMappingByPackagingId(picqerPackagingId: number): Promise<TagPackagingMap | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .select()
    .eq('picqer_packaging_id', picqerPackagingId)
    .maybeSingle()

  if (error) {
    console.error('Error fetching tag mapping by packaging id:', error)
    throw error
  }

  return data
}

/**
 * Delete tag mappings by picqer_packaging_id
 */
export async function deleteTagMappingByPackagingId(picqerPackagingId: number): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .delete()
    .eq('picqer_packaging_id', picqerPackagingId)

  if (error) {
    console.error('Error deleting tag mapping by packaging id:', error)
    throw error
  }
}

/**
 * Get tag mappings for specific tag titles
 */
export async function getTagMappingsByTags(tagTitles: string[]): Promise<TagPackagingMap[]> {
  if (tagTitles.length === 0) return []

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('tag_packaging_map')
    .select()
    .in('tag_title', tagTitles)
    .eq('is_active', true)
    .order('tag_title', { ascending: true })

  if (error) {
    console.error('Error fetching tag mappings by tags:', error)
    throw error
  }

  return data || []
}
