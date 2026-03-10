import { SingleOrderWithProduct, ProductGroup } from '@/types/singleOrder'
import { buildCombinationDisplayName } from '@/lib/picqer/singleOrders'

/**
 * Group orders by combination fingerprint.
 *
 * Groups orders that share the same product combination (same products
 * in same quantities) and filters to groups meeting minimum size.
 *
 * Cross-retailer: orders from different retailers with the same combination
 * are merged into one group.
 */
export function groupOrdersByCombination(
  orders: SingleOrderWithProduct[],
  minimumGroupSize: number = 5
): ProductGroup[] {
  const groupMap = new Map<string, ProductGroup>()

  for (const order of orders) {
    const fp = order.combinationFingerprint

    if (!groupMap.has(fp)) {
      groupMap.set(fp, {
        fingerprint: fp,
        combinationProducts: order.combinationProducts,
        displayName: buildCombinationDisplayName(order.combinationProducts),
        orders: [],
        totalCount: 0,
        retailerBreakdown: {},
        isSelected: false,
      })
    }

    const group = groupMap.get(fp)!
    group.orders.push(order)
    group.totalCount++
    group.retailerBreakdown[order.retailerName] =
      (group.retailerBreakdown[order.retailerName] || 0) + 1
  }

  return Array.from(groupMap.values())
    .filter(group => group.totalCount >= minimumGroupSize)
    .sort((a, b) => b.totalCount - a.totalCount)
}

/**
 * Filter product groups based on selected retailers.
 *
 * Only count orders from selected retailers towards the group total.
 * Remove groups that fall below minimum after filtering.
 */
export function filterGroupsByRetailers(
  groups: ProductGroup[],
  selectedRetailers: string[],
  minimumGroupSize: number = 5
): ProductGroup[] {
  if (selectedRetailers.length === 0) {
    return groups
  }

  return groups
    .map(group => {
      const filteredOrders = group.orders.filter(order =>
        selectedRetailers.includes(order.retailerName)
      )

      const retailerBreakdown: Record<string, number> = {}
      for (const order of filteredOrders) {
        retailerBreakdown[order.retailerName] =
          (retailerBreakdown[order.retailerName] || 0) + 1
      }

      return {
        ...group,
        orders: filteredOrders,
        totalCount: filteredOrders.length,
        retailerBreakdown,
      }
    })
    .filter(group => group.totalCount >= minimumGroupSize)
    .sort((a, b) => b.totalCount - a.totalCount)
}
