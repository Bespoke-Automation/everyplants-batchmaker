/**
 * Sort picklists by product popularity (most-ordered product first).
 *
 * Used in BatchOverview and VerpakkingsClient navigation to group picklists
 * by the most popular plant product, so warehouse workers pack the same
 * product consecutively.
 */

import type { BatchPicklistItem } from '@/types/verpakking'

interface ProductWithAllocations {
  productcode: string
  picklistAllocations?: { idpicklist: number; amount: number }[]
}

/**
 * Sort picklists so that the ones containing the most-ordered product come first,
 * then the next most-ordered product, etc. Packaging/box products are excluded
 * from the popularity count.
 */
export function sortPicklistsByProduct(
  products: ProductWithAllocations[] | undefined,
  picklists: BatchPicklistItem[],
  packagingProductcodes: Set<string>
): BatchPicklistItem[] {
  if (!products || products.length === 0 || picklists.length <= 1) {
    return picklists
  }

  // Filter out packaging products and products without allocations
  const plantProducts = products.filter(
    (p) => !packagingProductcodes.has(p.productcode) && p.picklistAllocations?.length
  )

  if (plantProducts.length === 0) return picklists

  // Sort products by total amount descending
  const sortedProducts = [...plantProducts].sort((a, b) => {
    const totalA = a.picklistAllocations!.reduce((sum, al) => sum + al.amount, 0)
    const totalB = b.picklistAllocations!.reduce((sum, al) => sum + al.amount, 0)
    return totalB - totalA
  })

  // Build ranked picklist order
  const result: BatchPicklistItem[] = []
  const added = new Set<number>() // idpicklist

  for (const product of sortedProducts) {
    // Get picklist IDs for this product, sorted by amount desc (most of this product first)
    const allocations = [...product.picklistAllocations!].sort(
      (a, b) => b.amount - a.amount
    )

    for (const alloc of allocations) {
      if (added.has(alloc.idpicklist)) continue
      const picklist = picklists.find((pl) => pl.idpicklist === alloc.idpicklist)
      if (picklist) {
        result.push(picklist)
        added.add(alloc.idpicklist)
      }
    }
  }

  // Append any remaining picklists not covered by product allocations
  for (const pl of picklists) {
    if (!added.has(pl.idpicklist)) {
      result.push(pl)
      added.add(pl.idpicklist)
    }
  }

  return result
}
