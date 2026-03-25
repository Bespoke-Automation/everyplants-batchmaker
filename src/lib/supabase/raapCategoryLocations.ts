import { supabase } from './client'

export type RaapCategory = 'kamerplanten' | 'buitenplanten' | 'kunstplanten' | 'potten'

export interface RaapCategoryLocation {
  id: string
  picqer_location_id: number
  picqer_location_name: string
  category: RaapCategory
  created_at: string
}

export async function getCategoryLocations(): Promise<RaapCategoryLocation[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('raap_category_locations')
    .select('*')
    .order('picqer_location_name')

  if (error) throw error
  return data || []
}

export async function saveCategoryLocations(
  locations: { picqer_location_id: number; picqer_location_name: string; category: RaapCategory }[]
): Promise<void> {
  // Delete all existing mappings then insert new ones
  const { error: deleteError } = await supabase
    .schema('batchmaker')
    .from('raap_category_locations')
    .delete()
    .gte('created_at', '1970-01-01') // required filter to delete all rows

  if (deleteError) throw deleteError
  if (locations.length === 0) return

  const { error: insertError } = await supabase
    .schema('batchmaker')
    .from('raap_category_locations')
    .insert(locations)

  if (insertError) throw insertError
}

/** Returns a Map of picqer_location_id -> category for fast lookup */
export async function getCategoryLocationMap(): Promise<Map<number, RaapCategory>> {
  const locations = await getCategoryLocations()
  return new Map(locations.map(l => [l.picqer_location_id, l.category]))
}

/** Returns a Map of picqer_location_name (lowercase) -> category for fallback name-based lookup */
export async function getCategoryLocationNameMap(): Promise<Map<string, RaapCategory>> {
  const locations = await getCategoryLocations()
  return new Map(locations.map(l => [l.picqer_location_name.toLowerCase(), l.category]))
}
