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

// Productcode prefixes for non-plant items (boxes, flyers, etc.)
// These are excluded when counting plants for single orders
const EXCLUDED_PRODUCTCODE_PREFIXES = [
  '55_',      // Boxes (tupe, fold, euro, surprise boxes)
  '333017',   // Plantura boxes and inlays
]

// Full productcodes to exclude (items that don't match prefix patterns)
const EXCLUDED_PRODUCTCODES = new Set([
  '1',        // Flyer Green Bubble
])

/**
 * Check if a product should be excluded from plant count based on productcode
 */
function isExcludedProduct(productcode: string): boolean {
  const upperCode = productcode.toUpperCase()

  // Check exact matches
  if (EXCLUDED_PRODUCTCODES.has(productcode)) {
    return true
  }

  // Check prefixes
  return EXCLUDED_PRODUCTCODE_PREFIXES.some(prefix =>
    upperCode.startsWith(prefix.toUpperCase())
  )
}

/**
 * Analyze order products to determine if it's a single order
 *
 * Rules:
 * - Must have exactly 1 plant (non-excluded product) with amount 1
 * - Products with excluded productcodes (boxes, flyers, etc.) don't count
 *
 * Example single orders:
 * - 1x Strelitzia Nicolai ✓
 * - 1x Strelitzia + 1x Sale box (55_xxx) ✓
 *
 * Example NOT single orders:
 * - 2x Strelitzia Nicolai ✗
 * - 1x Strelitzia + 1x Philodendron ✗
 */
export function analyzeSingleOrder(products: PicqerOrderProduct[]): SingleOrderAnalysis {
  let plantProduct: SingleOrderAnalysis['plantProduct'] = null
  let totalPlantCount = 0
  let excludedProductCount = 0

  for (const product of products) {
    if (isExcludedProduct(product.productcode)) {
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
