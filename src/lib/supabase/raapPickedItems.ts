import { supabase } from './client'

export interface RaapPickedItem {
  id: string
  picklist_batch_id: number
  picklist_id: number
  product_id: number
  productcode: string
  product_name: string
  location: string
  qty_picked: number
  picked_at: string
}

export async function getPickedItems(): Promise<RaapPickedItem[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('raap_picked_items')
    .select('*')
    .order('picked_at', { ascending: false })

  if (error) throw error
  return data || []
}

export async function recordPickedItems(
  items: Omit<RaapPickedItem, 'id' | 'picked_at'>[]
): Promise<void> {
  if (items.length === 0) return

  // Upsert: update qty if same picklist+product already exists
  const { error } = await supabase
    .schema('batchmaker')
    .from('raap_picked_items')
    .upsert(items, { onConflict: 'picklist_id,product_id' })

  if (error) throw error
}

export async function cleanupClosedPicklistItems(closedPicklistIds: number[]): Promise<void> {
  if (closedPicklistIds.length === 0) return

  const { error } = await supabase
    .schema('batchmaker')
    .from('raap_picked_items')
    .delete()
    .in('picklist_id', closedPicklistIds)

  if (error) throw error
}
