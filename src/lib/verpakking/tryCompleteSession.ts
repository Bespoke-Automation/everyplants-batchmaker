import {
  getBoxesBySession,
  getPackingSession,
  updatePackingSession,
} from '@/lib/supabase/packingSessions'
import {
  pickAllProducts,
  closePicklist,
  fetchPicklist,
  fetchOrder,
} from '@/lib/picqer/client'
import { getLocalPackagings } from '@/lib/supabase/localPackagings'
import { recordSessionOutcome } from '@/lib/engine/feedbackTracking'

export interface SessionCompletionResult {
  sessionCompleted: boolean
  productsIncomplete: boolean
  warning?: string
  outcome?: string
  deviationType?: string
}

/**
 * Count only "real" pickable products — excludes packaging products,
 * composition parents (virtual sets), and packaging composition parts (inlays, boxes).
 * This mirrors the filtering logic in VerpakkingsClient.tsx (lines 656-662).
 */
function countRealPicklistProducts(
  picklistProducts: { idproduct: number; productcode: string; amount: number }[],
  orderProducts: { idorder_product: number; idproduct: number; productcode: string; has_parts: boolean; partof_idorder_product: number | null }[],
  packagingBarcodes: Set<string>,
): number {
  // Build composition map from order products (same logic as VerpakkingsClient)
  const parents = new Map<number, typeof orderProducts[0]>()
  for (const p of orderProducts) {
    if (p.has_parts) parents.set(p.idorder_product, p)
  }

  // Map child idproduct → parent info
  const compositionMap = new Map<number, { parentIdProduct: number; parentIsPackaging: boolean }>()
  const compositionParentIds = new Set<number>()
  for (const p of orderProducts) {
    if (p.partof_idorder_product) {
      const parent = parents.get(p.partof_idorder_product)
      if (parent) {
        compositionParentIds.add(parent.idproduct)
        compositionMap.set(p.idproduct, {
          parentIdProduct: parent.idproduct,
          parentIsPackaging: packagingBarcodes.has(parent.productcode),
        })
      }
    }
  }

  // Count only real products (same filter as UI)
  let total = 0
  for (const pp of picklistProducts) {
    // Skip packaging products (boxes appearing as line items)
    if (packagingBarcodes.has(pp.productcode)) continue
    // Skip composition parents (virtual sets)
    if (compositionParentIds.has(pp.idproduct)) continue
    // Skip packaging composition parts (inlays etc.)
    const compInfo = compositionMap.get(pp.idproduct)
    if (compInfo?.parentIsPackaging) continue

    total += pp.amount
  }

  return total
}

/**
 * Attempt to complete a packing session after all boxes are shipped.
 * Returns early WITHOUT closing if not all picklist products are packed.
 */
export async function tryCompleteSession(
  sessionId: string,
  picklistId: number,
): Promise<SessionCompletionResult> {
  // Step 1: Check if all boxes are shipped
  const allBoxes = await getBoxesBySession(sessionId)
  const allBoxesShipped = allBoxes.length > 0 && allBoxes.every(
    b => b.status === 'label_fetched' || b.status === 'shipped' || b.status === 'shipment_created'
  )

  if (!allBoxesShipped) {
    return { sessionCompleted: false, productsIncomplete: false }
  }

  // Step 2: Check product completeness — this is a HARD BLOCK
  let totalPicklistProducts = 0
  let totalPackedProducts = 0
  try {
    const picklist = await fetchPicklist(picklistId)

    // Build packaging barcodes set from local packagings
    const localPackagings = await getLocalPackagings()
    const packagingBarcodes = new Set<string>()
    for (const lp of localPackagings) {
      if (lp.barcode && lp.active) packagingBarcodes.add(lp.barcode)
    }

    // Fetch order to get composition info (has_parts, partof_idorder_product)
    let orderProducts: { idorder_product: number; idproduct: number; productcode: string; has_parts: boolean; partof_idorder_product: number | null }[] = []
    try {
      const order = await fetchOrder(picklist.idorder)
      orderProducts = order.products || []
    } catch (e) {
      console.warn('[tryCompleteSession] Could not fetch order for composition filtering, counting all products:', e)
    }

    // Count only real pickable products (excluding packaging + composition parts)
    totalPicklistProducts = countRealPicklistProducts(picklist.products, orderProducts, packagingBarcodes)

    const sessionWithProducts = await getPackingSession(sessionId)
    totalPackedProducts = sessionWithProducts.packing_session_boxes.reduce(
      (sum, box) => sum + box.packing_session_products.reduce((s, p) => s + p.amount, 0),
      0
    )

    console.log(`[tryCompleteSession] Product count: ${totalPackedProducts} packed / ${totalPicklistProducts} real products (picklist total: ${picklist.products.reduce((s, p) => s + p.amount, 0)})`)
  } catch (e) {
    console.error('[tryCompleteSession] Error checking product completeness:', e)
    // If we can't verify, don't close — safer to keep open
    return {
      sessionCompleted: false,
      productsIncomplete: true,
      warning: 'Kan productcompleetheid niet verifiëren. Picklist niet afgesloten.',
    }
  }

  if (totalPackedProducts < totalPicklistProducts) {
    console.log(`[tryCompleteSession] Products incomplete: ${totalPackedProducts}/${totalPicklistProducts} — NOT closing picklist`)
    return {
      sessionCompleted: false,
      productsIncomplete: true,
      warning: `Niet alle producten uit de picklist zijn ingepakt (${totalPackedProducts} van ${totalPicklistProducts}). Maak meer dozen aan om de overige producten te verzenden.`,
    }
  }

  // Step 3: All products packed — safe to close
  let closeWarning: string | undefined

  // Pick all products in Picqer (required before closing)
  try {
    await pickAllProducts(picklistId)
  } catch (e) {
    console.error('[tryCompleteSession] Failed to pick all products:', e)
    closeWarning = 'Failed to pick all products in Picqer before closing. '
  }

  // Close picklist in Picqer
  try {
    const closeResult = await closePicklist(picklistId)
    if (!closeResult.success) {
      console.error('[tryCompleteSession] Failed to close picklist:', closeResult.error)
      closeWarning = (closeWarning || '') + `Picklist close failed: ${closeResult.error}. Please close manually in Picqer.`
    }
  } catch (e) {
    console.error('[tryCompleteSession] Error closing picklist:', e)
    closeWarning = (closeWarning || '') + `Picklist close error: ${e instanceof Error ? e.message : 'Unknown error'}. `
  }

  // Complete session in Supabase
  await updatePackingSession(sessionId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
  })

  // Record feedback (non-blocking)
  let outcomeData: { outcome: string; deviationType: string } | null = null
  try {
    outcomeData = await recordSessionOutcome(sessionId)
  } catch (e) {
    console.error('[tryCompleteSession] Error recording session outcome:', e)
  }

  // Analyze for capacity learning (non-blocking)
  try {
    const { analyzeCompletedSession } = await import('@/lib/engine/sessionAnalyzer')
    await analyzeCompletedSession(sessionId)
  } catch (e) {
    console.error('[tryCompleteSession] Error analyzing session:', e)
  }

  // Learn packing pattern (non-blocking)
  try {
    const { recordPackingPatternFromSession } = await import('@/lib/engine/patternLearner')
    await recordPackingPatternFromSession(sessionId)
  } catch (err) {
    console.error('[tryCompleteSession] Error recording packing pattern:', err)
  }

  return {
    sessionCompleted: true,
    productsIncomplete: false,
    warning: closeWarning,
    outcome: outcomeData?.outcome,
    deviationType: outcomeData?.deviationType,
  }
}
