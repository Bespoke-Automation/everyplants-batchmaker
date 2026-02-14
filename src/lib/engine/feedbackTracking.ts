/**
 * Feedback Tracking
 *
 * Records the outcome of a packing session by comparing
 * the engine's packaging advice with the actual boxes used.
 * This data is used to measure and improve engine quality.
 */

import { supabase } from '@/lib/supabase/client'
import { getPackingSession } from '@/lib/supabase/packingSessions'

interface ActualBox {
  packaging_name: string
  picqer_packaging_id: number | null
  products: { productcode: string; amount: number }[]
}

export interface SessionOutcomeResult {
  outcome: string
  deviationType: string
}

/**
 * Record the outcome of a packing session by comparing
 * actual boxes vs engine-advised boxes.
 * Called when all boxes in a session are shipped (session completed).
 */
export async function recordSessionOutcome(sessionId: string): Promise<SessionOutcomeResult | null> {
  // 1. Fetch the full session (boxes + products)
  const session = await getPackingSession(sessionId)

  // 2. Build actual_boxes snapshot
  const actualBoxes: ActualBox[] = session.packing_session_boxes.map(box => ({
    packaging_name: box.packaging_name,
    picqer_packaging_id: box.picqer_packaging_id,
    products: box.packing_session_products.map(p => ({
      productcode: p.productcode,
      amount: p.amount,
    })),
  }))

  // 3. Find the packaging_advice record (via packaging_advice_id on any box)
  const adviceId = session.packing_session_boxes
    .map(b => b.packaging_advice_id)
    .find(id => id != null)

  if (!adviceId) {
    // No engine advice was used — no comparison needed
    return null
  }

  // 4. Fetch the advice record
  const { data: advice } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('id, advice_boxes, confidence')
    .eq('id', adviceId)
    .single()

  if (!advice) return null

  // 5. Compute outcome
  const adviceBoxes = (advice.advice_boxes as { idpackaging: number }[]) || []
  const { outcome, deviationType } = computeOutcome(adviceBoxes, actualBoxes)

  // 6. Update the advice record with tracking data
  await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .update({
      outcome,
      actual_boxes: actualBoxes,
      deviation_type: deviationType,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', adviceId)

  console.log(`[feedbackTracking] Recorded outcome for advice ${adviceId}: ${outcome} (${deviationType})`)

  return { outcome, deviationType }
}

/**
 * Compare advised boxes with actual boxes to determine the outcome.
 * Uses multiset comparison: [10, 10, 20] vs [10, 20, 20] are different.
 */
function computeOutcome(
  adviceBoxes: { idpackaging: number }[],
  actualBoxes: ActualBox[]
): { outcome: string; deviationType: string } {
  if (adviceBoxes.length === 0) {
    return { outcome: 'no_advice', deviationType: 'none' }
  }

  const advisedIds = adviceBoxes.map(b => b.idpackaging).sort((a, b) => a - b)
  const actualIds = actualBoxes
    .map(b => b.picqer_packaging_id)
    .filter((id): id is number => id != null)
    .sort((a, b) => a - b)

  // Exact match (same packaging IDs in same quantities — multiset comparison)
  if (JSON.stringify(advisedIds) === JSON.stringify(actualIds)) {
    return { outcome: 'followed', deviationType: 'none' }
  }

  // Multiset overlap: count how many advised items appear in actual (quantity-aware)
  const actualCounts = new Map<number, number>()
  for (const id of actualIds) {
    actualCounts.set(id, (actualCounts.get(id) ?? 0) + 1)
  }
  let overlapCount = 0
  const remainingActual = new Map(actualCounts)
  for (const id of advisedIds) {
    const available = remainingActual.get(id) ?? 0
    if (available > 0) {
      overlapCount++
      remainingActual.set(id, available - 1)
    }
  }

  // Fully ignored (no overlap at all)
  if (overlapCount === 0) {
    return { outcome: 'ignored', deviationType: 'different_packaging' }
  }

  // Partially modified — determine type
  if (actualIds.length > advisedIds.length) {
    if (overlapCount === advisedIds.length) {
      return { outcome: 'modified', deviationType: 'extra_boxes' }
    }
    return { outcome: 'modified', deviationType: 'mixed' }
  }

  if (actualIds.length < advisedIds.length) {
    return { outcome: 'modified', deviationType: 'fewer_boxes' }
  }

  return { outcome: 'modified', deviationType: 'different_packaging' }
}
