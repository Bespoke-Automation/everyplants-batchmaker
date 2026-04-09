import { supabase } from './client'

/**
 * Fetch product attributes from Supabase, indexed by picqer_product_id.
 * Used by both the single picklist-data endpoint and the bulk batch-workspace endpoint.
 */
export async function fetchProductAttributes(productIds: number[]): Promise<Record<number, {
  productType: string | null
  potSize: number | null
  height: number | null
  isFragile: boolean
  isMixable: boolean
}>> {
  if (productIds.length === 0) return {}

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, product_type, pot_size, height, is_fragile, is_mixable')
    .in('picqer_product_id', productIds)

  if (error) {
    console.error('[fetchProductAttributes] Error:', error)
    return {}
  }

  const attributes: Record<number, {
    productType: string | null
    potSize: number | null
    height: number | null
    isFragile: boolean
    isMixable: boolean
  }> = {}

  for (const row of data || []) {
    attributes[row.picqer_product_id] = {
      productType: row.product_type ?? null,
      potSize: row.pot_size ?? null,
      height: row.height ?? null,
      isFragile: row.is_fragile ?? false,
      isMixable: row.is_mixable ?? true,
    }
  }

  return attributes
}
