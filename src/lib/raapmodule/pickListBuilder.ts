import { getPicklistBatches, getPicklistBatch, fetchPicklist } from '@/lib/picqer/client'
import { getCategoryLocationNameMap, type RaapCategory } from '@/lib/supabase/raapCategoryLocations'
import { getVervoerders } from '@/lib/supabase/vervoerders'
import { supabase } from '@/lib/supabase/client'

/** Get set of packaging barcodes to exclude from pick lists */
async function getPackagingBarcodes(): Promise<Set<string>> {
  const { data } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('barcode')
  return new Set((data || []).map(p => p.barcode).filter(Boolean))
}

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
  vervoerder_id?: string | string[]
): Promise<PickListItem[]> {
  // 1. Get location name -> category map + packaging barcodes to exclude
  const [locationNameMap, packagingBarcodes] = await Promise.all([
    getCategoryLocationNameMap(),
    getPackagingBarcodes(),
  ])

  // 2. Get vervoerder shipping profile IDs if filtering
  let allowedProfileIds: Set<number> | null = null
  if (vervoerder_id) {
    const ids = Array.isArray(vervoerder_id) ? vervoerder_id : [vervoerder_id]
    const vervoerders = await getVervoerders()
    const profileIds: number[] = []
    for (const id of ids) {
      const vervoerder = vervoerders.find(v => v.id === id)
      if (vervoerder) {
        profileIds.push(...vervoerder.profiles.map(p => p.shipping_profile_id))
      }
    }
    if (profileIds.length > 0) {
      allowedProfileIds = new Set(profileIds)
    }
  }

  // 3. Fetch open batches
  const batches = await getPicklistBatches({ status: 'open' })

  const aggregated = new Map<string, PickListItem>()

  // Cache for picklist shipping profiles (used only when vervoerder filter is active)
  const picklistProfileCache = new Map<number, number | null>()

  for (const batch of batches) {
    // 4. Get full batch detail — products include stock_location
    const batchDetail = await getPicklistBatch(batch.idpicklist_batch)

    for (const batchProduct of batchDetail.products ?? []) {
      if (!batchProduct.stock_location) continue
      if (packagingBarcodes.has(batchProduct.productcode)) continue

      // 5. Check if this product's location belongs to the requested category
      const productCategory = locationNameMap.get(batchProduct.stock_location.toLowerCase())
      if (productCategory !== category) continue

      // 6. Sum quantities across picklist allocations
      let qtyNeeded = 0
      const picklistIds: number[] = []

      for (const alloc of batchProduct.picklists) {
        const qty = alloc.amount - alloc.amount_picked
        if (qty <= 0) continue

        // Filter by vervoerder if specified
        if (allowedProfileIds !== null) {
          if (!picklistProfileCache.has(alloc.idpicklist)) {
            const pl = await fetchPicklist(alloc.idpicklist)
            picklistProfileCache.set(alloc.idpicklist, pl.idshippingprovider_profile ?? null)
          }
          const profileId = picklistProfileCache.get(alloc.idpicklist)
          if (!profileId || !allowedProfileIds.has(profileId)) continue
        }

        qtyNeeded += qty
        if (!picklistIds.includes(alloc.idpicklist)) {
          picklistIds.push(alloc.idpicklist)
        }
      }

      if (qtyNeeded <= 0) continue

      const key = `${batchProduct.idproduct}::${batchProduct.stock_location}`
      const existing = aggregated.get(key)

      if (existing) {
        existing.qty_needed += qtyNeeded
        if (!existing.batch_ids.includes(batch.idpicklist_batch)) {
          existing.batch_ids.push(batch.idpicklist_batch)
        }
        for (const pid of picklistIds) {
          if (!existing.picklist_ids.includes(pid)) {
            existing.picklist_ids.push(pid)
          }
        }
      } else {
        aggregated.set(key, {
          product_id: batchProduct.idproduct,
          productcode: batchProduct.productcode,
          product_name: batchProduct.name,
          location: batchProduct.stock_location,
          qty_needed: qtyNeeded,
          batch_ids: [batch.idpicklist_batch],
          picklist_ids: [...picklistIds],
        })
      }
    }
  }

  return Array.from(aggregated.values())
    .sort((a, b) => a.location.localeCompare(b.location) || a.product_name.localeCompare(b.product_name))
}

export interface PickListItemByBatch {
  product_id: number
  productcode: string
  product_name: string
  location: string
  qty_needed: number
  batch_id: number
  batch_name: string
}

/** Build pick list with items kept separate per batch (not aggregated) */
export async function buildPickListByBatch(
  category: RaapCategory
): Promise<PickListItemByBatch[]> {
  const [locationNameMap, packagingBarcodes] = await Promise.all([
    getCategoryLocationNameMap(),
    getPackagingBarcodes(),
  ])
  const batches = await getPicklistBatches({ status: 'open' })
  const items: PickListItemByBatch[] = []

  for (const batch of batches) {
    const batchDetail = await getPicklistBatch(batch.idpicklist_batch)
    const batchName = String(batchDetail.picklist_batchid || batch.idpicklist_batch)

    // Aggregate per product+location within this batch
    const batchAgg = new Map<string, PickListItemByBatch>()

    for (const batchProduct of batchDetail.products ?? []) {
      if (!batchProduct.stock_location) continue
      if (packagingBarcodes.has(batchProduct.productcode)) continue

      const productCategory = locationNameMap.get(batchProduct.stock_location.toLowerCase())
      if (productCategory !== category) continue

      let qtyNeeded = 0
      for (const alloc of batchProduct.picklists) {
        const qty = alloc.amount - alloc.amount_picked
        if (qty > 0) qtyNeeded += qty
      }
      if (qtyNeeded <= 0) continue

      const key = `${batchProduct.idproduct}::${batchProduct.stock_location}`
      const existing = batchAgg.get(key)
      if (existing) {
        existing.qty_needed += qtyNeeded
      } else {
        batchAgg.set(key, {
          product_id: batchProduct.idproduct,
          productcode: batchProduct.productcode,
          product_name: batchProduct.name,
          location: batchProduct.stock_location,
          qty_needed: qtyNeeded,
          batch_id: batch.idpicklist_batch,
          batch_name: batchName,
        })
      }
    }

    items.push(...batchAgg.values())
  }

  return items.sort((a, b) =>
    a.batch_name.localeCompare(b.batch_name) ||
    a.location.localeCompare(b.location) ||
    a.product_name.localeCompare(b.product_name)
  )
}
