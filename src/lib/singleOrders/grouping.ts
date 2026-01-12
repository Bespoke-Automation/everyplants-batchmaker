import { SingleOrderWithProduct, ProductGroup } from '@/types/singleOrder'

/**
 * Group single orders by product
 *
 * Groups orders by plant product and filters to only include groups
 * that meet the minimum size threshold (default: 5 orders).
 *
 * Cross-retailer grouping: If Everspring has 3 orders for Strelitzia
 * and Green Bubble has 3 orders for Strelitzia, they combine to 6 orders
 * in the same group.
 */
export function groupSingleOrdersByProduct(
  orders: SingleOrderWithProduct[],
  minimumGroupSize: number = 5
): ProductGroup[] {
  const groupMap = new Map<number, ProductGroup>()

  for (const order of orders) {
    const productId = order.plantProduct.idproduct

    if (!groupMap.has(productId)) {
      groupMap.set(productId, {
        productId,
        productCode: order.plantProduct.productcode,
        productName: order.plantProduct.name,
        orders: [],
        totalCount: 0,
        retailerBreakdown: {},
        isSelected: false,
      })
    }

    const group = groupMap.get(productId)!
    group.orders.push(order)
    group.totalCount++
    group.retailerBreakdown[order.retailerName] =
      (group.retailerBreakdown[order.retailerName] || 0) + 1
  }

  // Filter to only groups with minimum size and sort by count descending
  return Array.from(groupMap.values())
    .filter(group => group.totalCount >= minimumGroupSize)
    .sort((a, b) => b.totalCount - a.totalCount)
}

/**
 * Filter product groups based on selected retailers
 *
 * When filtering by retailer, only count orders from selected retailers
 * towards the group total. Remove groups that fall below minimum after filtering.
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
      // Filter orders to only selected retailers
      const filteredOrders = group.orders.filter(order =>
        selectedRetailers.includes(order.retailerName)
      )

      // Recalculate retailer breakdown
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
