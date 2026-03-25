import {
  getBoxesBySession,
  getPackingSession,
  updatePackingSession,
} from '@/lib/supabase/packingSessions'
import {
  pickAllProducts,
  closePicklist,
  fetchPicklist,
} from '@/lib/picqer/client'
import { recordSessionOutcome } from '@/lib/engine/feedbackTracking'

export interface SessionCompletionResult {
  sessionCompleted: boolean
  productsIncomplete: boolean
  warning?: string
  outcome?: string
  deviationType?: string
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
    b => b.status === 'label_fetched' || b.status === 'shipped'
  )

  if (!allBoxesShipped) {
    return { sessionCompleted: false, productsIncomplete: false }
  }

  // Step 2: Check product completeness — this is a HARD BLOCK
  let totalPicklistProducts = 0
  let totalPackedProducts = 0
  try {
    const picklist = await fetchPicklist(picklistId)
    totalPicklistProducts = picklist.products.reduce((sum, p) => sum + p.amount, 0)
    const sessionWithProducts = await getPackingSession(sessionId)
    totalPackedProducts = sessionWithProducts.packing_session_boxes.reduce(
      (sum, box) => sum + box.packing_session_products.reduce((s, p) => s + p.amount, 0),
      0
    )
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

  return {
    sessionCompleted: true,
    productsIncomplete: false,
    warning: closeWarning,
    outcome: outcomeData?.outcome,
    deviationType: outcomeData?.deviationType,
  }
}
