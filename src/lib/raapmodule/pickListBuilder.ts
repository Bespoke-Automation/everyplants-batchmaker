import { getPicklistBatches, getPicklistBatchPicklists, fetchPicklist } from '@/lib/picqer/client'
import { getCategoryLocationMap, type RaapCategory } from '@/lib/supabase/raapCategoryLocations'
import { getVervoerders } from '@/lib/supabase/vervoerders'

export interface PickListItem {
  product_id: number
  productcode: string
  product_name: string
  location: string
  qty_needed: number
  batch_ids: number[]
  picklist_ids: number[]
}

export async function buildPickList(
  category: RaapCategory,
  vervoerder_id?: string
): Promise<PickListItem[]> {
  // 1. Get location -> category map
  const locationMap = await getCategoryLocationMap()

  // 2. Get vervoerder shipping profile IDs if filtering
  let allowedProfileIds: Set<number> | null = null
  if (vervoerder_id) {
    const vervoerders = await getVervoerders()
    const vervoerder = vervoerders.find(v => v.id === vervoerder_id)
    if (vervoerder) {
      allowedProfileIds = new Set(vervoerder.profiles.map(p => p.shipping_profile_id))
    }
  }

  // 3. Fetch open batches
  const batches = await getPicklistBatches({ status: 'open' })

  const aggregated = new Map<string, PickListItem>()

  for (const batch of batches) {
    // 4. Get picklist summaries for this batch
    const batchPicklists = await getPicklistBatchPicklists(batch.idpicklist_batch)

    for (const batchPicklist of batchPicklists) {
      // Skip closed/cancelled
      if (batchPicklist.status === 'closed' || batchPicklist.status === 'cancelled') continue

      // 5. Fetch full picklist (has products + idshippingprovider_profile)
      const fullPicklist = await fetchPicklist(batchPicklist.idpicklist)

      // 6. Filter by vervoerder if specified
      if (allowedProfileIds !== null) {
        const profileId = fullPicklist.idshippingprovider_profile
        if (!profileId || !allowedProfileIds.has(profileId)) continue
      }

      // 7. Aggregate products
      for (const product of fullPicklist.products) {
        if (!product.location || !product.idlocation) continue

        const productCategory = locationMap.get(product.idlocation)
        if (productCategory !== category) continue

        const qty = product.amount - product.amount_picked
        if (qty <= 0) continue

        const key = `${product.idproduct}::${product.location}`
        const existing = aggregated.get(key)

        if (existing) {
          existing.qty_needed += qty
          if (!existing.batch_ids.includes(batch.idpicklist_batch)) {
            existing.batch_ids.push(batch.idpicklist_batch)
          }
          if (!existing.picklist_ids.includes(batchPicklist.idpicklist)) {
            existing.picklist_ids.push(batchPicklist.idpicklist)
          }
        } else {
          aggregated.set(key, {
            product_id: product.idproduct,
            productcode: product.productcode,
            product_name: product.name,
            location: product.location,
            qty_needed: qty,
            batch_ids: [batch.idpicklist_batch],
            picklist_ids: [batchPicklist.idpicklist],
          })
        }
      }
    }
  }

  return Array.from(aggregated.values())
    .sort((a, b) => a.location.localeCompare(b.location) || a.product_name.localeCompare(b.product_name))
}
