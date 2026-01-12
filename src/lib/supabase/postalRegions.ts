import { supabase } from './client'

export interface PostalRange {
  country: string
  from: string
  to: string
}

export interface PostalRegion {
  id: string
  region_id: string
  name: string
  countries: string[]
  postal_ranges: PostalRange[]
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface PostalRegionInsert {
  region_id: string
  name: string
  countries: string[]
  postal_ranges: PostalRange[]
  is_active?: boolean
  sort_order?: number
}

export interface PostalRegionUpdate {
  name?: string
  countries?: string[]
  postal_ranges?: PostalRange[]
  is_active?: boolean
  sort_order?: number
}

/**
 * Fetch all active postal regions, sorted by sort_order
 */
export async function getPostalRegions(): Promise<PostalRegion[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('postal_regions')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Error fetching postal regions:', error)
    throw error
  }

  return data || []
}

/**
 * Fetch all postal regions (including inactive), sorted by sort_order
 */
export async function getAllPostalRegions(): Promise<PostalRegion[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('postal_regions')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Error fetching all postal regions:', error)
    throw error
  }

  return data || []
}

/**
 * Create a new postal region
 */
export async function createPostalRegion(region: PostalRegionInsert): Promise<PostalRegion> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('postal_regions')
    .insert(region)
    .select()
    .single()

  if (error) {
    console.error('Error creating postal region:', error)
    throw error
  }

  return data
}

/**
 * Update an existing postal region
 */
export async function updatePostalRegion(id: string, updates: PostalRegionUpdate): Promise<PostalRegion> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('postal_regions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating postal region:', error)
    throw error
  }

  return data
}

/**
 * Delete a postal region
 */
export async function deletePostalRegion(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('postal_regions')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting postal region:', error)
    throw error
  }
}

/**
 * Toggle a postal region's active status
 */
export async function togglePostalRegionActive(id: string, isActive: boolean): Promise<PostalRegion> {
  return updatePostalRegion(id, { is_active: isActive })
}

/**
 * Check if an order's postal code matches a region
 */
export function matchesPostalRegion(
  country: string,
  postalCode: string | null,
  region: PostalRegion
): boolean {
  // Check if country matches
  if (!region.countries.includes(country)) {
    return false
  }

  // If no postal ranges defined, all postal codes in those countries match
  if (!region.postal_ranges || region.postal_ranges.length === 0) {
    return true
  }

  // Check postal code ranges
  if (!postalCode) return false

  // Normalize postal code (remove spaces)
  const normalizedPostal = postalCode.replace(/\s/g, '')

  return region.postal_ranges.some(range => {
    if (range.country !== country) return false
    return normalizedPostal >= range.from && normalizedPostal <= range.to
  })
}
