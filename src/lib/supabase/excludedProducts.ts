import { supabase } from './client'

export interface ExcludedProduct {
  id: string
  picqer_product_id: number
  productcode: string
  name: string
  last_synced_at: string
}

/**
 * Get all excluded products from the database
 */
export async function getExcludedProducts(): Promise<ExcludedProduct[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('excluded_products')
    .select('id, picqer_product_id, productcode, name, last_synced_at')
    .order('productcode', { ascending: true })

  if (error) {
    console.error('Error fetching excluded products:', error)
    throw error
  }

  return data || []
}

/**
 * Get excluded product codes as a Set for fast lookups
 */
export async function getExcludedProductCodes(): Promise<Set<string>> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('excluded_products')
    .select('productcode')

  if (error) {
    console.error('Error fetching excluded product codes:', error)
    throw error
  }

  return new Set(data?.map(p => p.productcode) || [])
}

/**
 * Trigger sync of excluded products via API route
 * This calls the server-side API that fetches from Picqer and updates the database
 */
export async function syncExcludedProducts(): Promise<{ added: number; removed: number; total: number }> {
  const response = await fetch('/api/sync-excluded-products', {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to sync excluded products')
  }

  return response.json()
}
