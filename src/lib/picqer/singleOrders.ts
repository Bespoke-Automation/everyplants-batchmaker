import { PicqerOrderProduct } from './types'
import { CombinationProduct } from '@/types/singleOrder'

export interface OrderCombinationAnalysis {
  fingerprint: string
  plantProducts: CombinationProduct[]
  totalPlantCount: number
  excludedProductCount: number
}

/**
 * Analyze order products to build a combination fingerprint.
 *
 * - Skips virtual composition parts (partof_idorder_product !== null)
 * - Skips excluded products (boxes, fertilizer, etc.)
 * - Builds a sorted fingerprint from idproduct:amount pairs
 *
 * Returns null if the order has no plant products.
 */
export function analyzeOrderCombination(
  products: PicqerOrderProduct[],
  excludedProductCodes: Set<string>
): OrderCombinationAnalysis | null {
  const plantProducts: CombinationProduct[] = []
  let totalPlantCount = 0
  let excludedProductCount = 0

  for (const product of products) {
    // Skip parts of virtual compositions (already counted via parent)
    if (product.partof_idorder_product !== null) {
      continue
    }

    if (excludedProductCodes.has(product.productcode)) {
      excludedProductCount += product.amount
      continue
    }

    totalPlantCount += product.amount
    plantProducts.push({
      idproduct: product.idproduct,
      productcode: product.productcode,
      name: product.name,
      amount: product.amount,
    })
  }

  if (totalPlantCount === 0) return null

  // Sort by idproduct for consistent fingerprint
  plantProducts.sort((a, b) => a.idproduct - b.idproduct)

  const fingerprint = plantProducts
    .map(p => `${p.idproduct}:${p.amount}`)
    .join('|')

  return {
    fingerprint,
    plantProducts,
    totalPlantCount,
    excludedProductCount,
  }
}

/**
 * Build a display-friendly name for a product combination.
 *
 * - Single product, amount 1: "Trachycarpus Fortunei"
 * - Single product, amount >1: "2x Trachycarpus Fortunei"
 * - Multi product: "Trachycarpus Fortunei + Pot X" (with amounts if >1)
 */
export function buildCombinationDisplayName(products: CombinationProduct[]): string {
  return products
    .map(p => p.amount > 1 ? `${p.amount}x ${p.name}` : p.name)
    .join(' + ')
}
