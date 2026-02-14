import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShippingUnitRow {
  id: string
  name: string
  product_type: string
  sort_order: number
  is_active: boolean
  pot_size_min: number | null
  pot_size_max: number | null
  height_min: number | null
  height_max: number | null
  is_fragile_filter: boolean
}

export interface ShippingUnitWithCount extends ShippingUnitRow {
  product_count: number
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all active shipping units ordered by product_type, sort_order
 */
export async function getActiveShippingUnits(): Promise<ShippingUnitRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shipping_units')
    .select('id, name, product_type, sort_order, is_active, pot_size_min, pot_size_max, height_min, height_max, is_fragile_filter')
    .eq('is_active', true)
    .order('product_type', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Error fetching shipping units:', error)
    throw error
  }

  return data || []
}

/**
 * Get all active shipping units with product counts
 */
export async function getActiveShippingUnitsWithCounts(): Promise<ShippingUnitWithCount[]> {
  // First get all shipping units
  const units = await getActiveShippingUnits()

  // Then get product counts per shipping unit
  const { data: productCounts, error: countError } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('shipping_unit_id')

  if (countError) {
    console.error('Error fetching product counts:', countError)
    throw countError
  }

  // Count products per shipping unit
  const counts: Record<string, number> = {}
  for (const row of productCounts || []) {
    if (row.shipping_unit_id) {
      counts[row.shipping_unit_id] = (counts[row.shipping_unit_id] || 0) + 1
    }
  }

  // Merge counts with units
  return units.map((unit) => ({
    ...unit,
    product_count: counts[unit.id] || 0,
  }))
}
