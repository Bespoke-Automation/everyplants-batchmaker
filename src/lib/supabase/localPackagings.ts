import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LocalPackagingRow {
  id: string
  idpackaging: number
  name: string
  barcode: string | null
  length: number | null
  width: number | null
  height: number | null
  max_weight: number | null
  box_category: string | null
  specificity_score: number
  handling_cost: number
  material_cost: number
  image_url: string | null
  use_in_auto_advice: boolean
  active: boolean
  last_synced_at: string
  created_at: string
  updated_at: string
  picqer_tag_name: string | null
  num_shipping_labels: number
  facturatie_box_sku: string | null
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all local packagings
 */
export async function getLocalPackagings(): Promise<LocalPackagingRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select()
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching local packagings:', error)
    throw error
  }

  return data || []
}

/**
 * Get active local packagings
 */
export async function getActiveLocalPackagings(): Promise<LocalPackagingRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select()
    .eq('active', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('Error fetching active local packagings:', error)
    throw error
  }

  return data || []
}

// ── Sync operations ──────────────────────────────────────────────────────────

/**
 * Upsert packagings from Picqer into local DB
 */
export async function upsertPackagingsFromPicqer(
  packagings: Array<{
    idpackaging: number
    name: string
    barcode: string | null
    length: number | null
    width: number | null
    height: number | null
    use_in_auto_advice: boolean
    active: boolean
  }>
): Promise<{ added: number; updated: number }> {
  if (packagings.length === 0) return { added: 0, updated: 0 }

  // Fetch existing to count
  const { data: existing } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('idpackaging')

  const existingIds = new Set((existing || []).map((p: { idpackaging: number }) => p.idpackaging))

  const rows = packagings.map((p) => ({
    idpackaging: p.idpackaging,
    name: p.name,
    barcode: p.barcode,
    length: p.length,
    width: p.width,
    height: p.height,
    use_in_auto_advice: p.use_in_auto_advice,
    active: p.active,
    last_synced_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .upsert(rows, { onConflict: 'idpackaging' })

  if (error) {
    console.error('Error upserting packagings:', error)
    throw error
  }

  const newItems = packagings.filter((p) => !existingIds.has(p.idpackaging))
  return {
    added: newItems.length,
    updated: packagings.length - newItems.length,
  }
}

/**
 * Insert a single packaging into local DB
 */
export async function insertLocalPackaging(packaging: {
  idpackaging: number
  name: string
  barcode?: string | null
  length?: number | null
  width?: number | null
  height?: number | null
  use_in_auto_advice?: boolean
  active?: boolean
}): Promise<LocalPackagingRow> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .insert({
      idpackaging: packaging.idpackaging,
      name: packaging.name,
      barcode: packaging.barcode ?? null,
      length: packaging.length ?? null,
      width: packaging.width ?? null,
      height: packaging.height ?? null,
      use_in_auto_advice: packaging.use_in_auto_advice ?? false,
      active: packaging.active ?? true,
      last_synced_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('Error inserting local packaging:', error)
    throw error
  }

  return data
}

/**
 * Delete a packaging from local DB by idpackaging
 */
export async function deleteLocalPackaging(idpackaging: number): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .delete()
    .eq('idpackaging', idpackaging)

  if (error) {
    console.error('Error deleting local packaging:', error)
    throw error
  }
}

/**
 * Update a packaging in local DB
 */
export async function updateLocalPackaging(
  idpackaging: number,
  updates: Partial<Pick<LocalPackagingRow, 'idpackaging' | 'name' | 'barcode' | 'length' | 'width' | 'height' | 'max_weight' | 'box_category' | 'specificity_score' | 'handling_cost' | 'material_cost' | 'use_in_auto_advice' | 'image_url' | 'facturatie_box_sku'>>
): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .update(updates)
    .eq('idpackaging', idpackaging)

  if (error) {
    console.error('Error updating local packaging:', error)
    throw error
  }
}
