import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShippingUnitRow {
  id: string
  name: string
  product_type: string
  sort_order: number
  is_active: boolean
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get all active shipping units ordered by product_type, sort_order
 */
export async function getActiveShippingUnits(): Promise<ShippingUnitRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shipping_units')
    .select('id, name, product_type, sort_order, is_active')
    .eq('is_active', true)
    .order('product_type', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Error fetching shipping units:', error)
    throw error
  }

  return data || []
}
