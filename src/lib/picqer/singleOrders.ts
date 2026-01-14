import { PicqerOrderProduct } from './types'

export interface SingleOrderAnalysis {
  isSingleOrder: boolean
  plantProduct: {
    idproduct: number
    productcode: string
    name: string
  } | null
  totalPlantCount: number
  excludedProductCount: number
}

/**
 * Analyze order products to determine if it's a single order
 *
 * Rules:
 * - Must have exactly 1 plant (non-excluded product) with amount 1
 * - Products with excluded productcodes (from Supabase, tagged "Overig" in Picqer) don't count
 * - Parts of virtual compositions are skipped (only parent counts)
 *
 * Example single orders:
 * - 1x Strelitzia Nicolai ✓
 * - 1x Strelitzia + 1x Box (excluded) ✓
 *
 * Example NOT single orders:
 * - 2x Strelitzia Nicolai ✗
 * - 1x Strelitzia + 1x Philodendron ✗
 * - 1x Strelitzia + 1x Fertilizer (not excluded) ✗
 */
export function analyzeSingleOrder(
  products: PicqerOrderProduct[],
  excludedProductCodes: Set<string>
): SingleOrderAnalysis {
  let plantProduct: SingleOrderAnalysis['plantProduct'] = null
  let totalPlantCount = 0
  let excludedProductCount = 0

  for (const product of products) {
    // Skip parts of virtual compositions (they're already counted via parent)
    if (product.partof_idorder_product !== null) {
      continue
    }

    // Check if product is excluded (tagged "Overig" in Picqer, synced to Supabase)
    if (excludedProductCodes.has(product.productcode)) {
      excludedProductCount += product.amount
      continue
    }

    // This is a plant product - add its amount to total
    totalPlantCount += product.amount

    // If this is the first plant product, capture it
    if (plantProduct === null) {
      plantProduct = {
        idproduct: product.idproduct,
        productcode: product.productcode,
        name: product.name,
      }
    }
  }

  // It's a single order only if total plant count is exactly 1
  const isSingleOrder = totalPlantCount === 1

  return {
    isSingleOrder,
    plantProduct: isSingleOrder ? plantProduct : null,
    totalPlantCount,
    excludedProductCount,
  }
}
