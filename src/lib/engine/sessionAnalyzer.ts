/**
 * Session Analyzer — Extracts capacity knowledge from completed packing sessions.
 *
 * After a warehouse worker completes a packing session, this module:
 * 1. Looks at which products ended up in which box
 * 2. Maps products to their shipping units
 * 3. Records observed capacities as feedback
 * 4. Logs coverage data for the dashboard
 *
 * This is the "learning" part of the system — every packed session makes the optimizer smarter.
 */

import { supabase } from '@/lib/supabase/client'
import { recordCapacityObservation } from '@/lib/supabase/capacityFeedback'

interface SessionBox {
  id: string
  picqer_packaging_id: number | null
  packaging_name: string
  products: {
    picqer_product_id: number
    productcode: string
    amount: number
  }[]
}

interface AnalysisResult {
  sessionId: string
  feedbackRecorded: number
  coverageLogged: boolean
  errors: string[]
}

/**
 * Analyze a completed packing session and extract capacity knowledge.
 */
export async function analyzeCompletedSession(sessionId: string): Promise<AnalysisResult> {
  const result: AnalysisResult = {
    sessionId,
    feedbackRecorded: 0,
    coverageLogged: false,
    errors: [],
  }

  try {
    // 1. Fetch session with boxes and products
    const { data: session, error: sessionError } = await supabase
      .schema('batchmaker')
      .from('packing_sessions')
      .select(`
        id, picklist_id, order_id,
        packing_session_boxes (
          id, picqer_packaging_id, packaging_name,
          packing_session_products (
            picqer_product_id, productcode, amount
          )
        )
      `)
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      result.errors.push(`Session not found: ${sessionError?.message ?? 'null'}`)
      return result
    }

    const boxes: SessionBox[] = (session.packing_session_boxes || []).map((b: Record<string, unknown>) => ({
      id: b.id as string,
      picqer_packaging_id: b.picqer_packaging_id as number | null,
      packaging_name: b.packaging_name as string,
      products: ((b.packing_session_products as Record<string, unknown>[]) || []).map((p: Record<string, unknown>) => ({
        picqer_product_id: p.picqer_product_id as number,
        productcode: p.productcode as string,
        amount: p.amount as number,
      })),
    }))

    // 2. Batch-fetch all packagings and product attributes to avoid N+1 queries
    const allPackagingIds = [...new Set(
      boxes.filter(b => b.picqer_packaging_id != null).map(b => b.picqer_packaging_id as number)
    )]
    const allProductIds = [...new Set(
      boxes.flatMap(b => b.products.map(p => p.picqer_product_id))
    )]

    // Fetch all packagings in one query
    const packagingMap = new Map<number, string>() // idpackaging → UUID
    if (allPackagingIds.length > 0) {
      const { data: packagings } = await supabase
        .schema('batchmaker')
        .from('packagings')
        .select('id, idpackaging')
        .in('idpackaging', allPackagingIds)
        .eq('active', true)

      if (packagings) {
        for (const p of packagings) {
          packagingMap.set(p.idpackaging, p.id)
        }
      }
    }

    // Fetch all product attributes in one query
    const productAttrMap = new Map<number, string>() // picqer_product_id → shipping_unit_id
    if (allProductIds.length > 0) {
      const { data: productAttrs } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('picqer_product_id, shipping_unit_id')
        .in('picqer_product_id', allProductIds)

      if (productAttrs) {
        for (const a of productAttrs) {
          if (a.shipping_unit_id) {
            productAttrMap.set(a.picqer_product_id, a.shipping_unit_id)
          }
        }
      }
    }

    // 3. Process each box using pre-fetched data
    for (const box of boxes) {
      if (!box.picqer_packaging_id || box.products.length === 0) continue

      const packagingUUID = packagingMap.get(box.picqer_packaging_id)
      if (!packagingUUID) continue

      // Aggregate: how many of each shipping unit ended up in this box
      const unitQuantities = new Map<string, number>()
      for (const product of box.products) {
        const shippingUnitId = productAttrMap.get(product.picqer_product_id)
        if (shippingUnitId) {
          const current = unitQuantities.get(shippingUnitId) || 0
          unitQuantities.set(shippingUnitId, current + product.amount)
        }
      }

      // Record each observed capacity
      for (const [shippingUnitId, quantity] of unitQuantities) {
        try {
          await recordCapacityObservation(
            packagingUUID,
            shippingUnitId,
            quantity,
            sessionId
          )
          result.feedbackRecorded++
        } catch (err) {
          result.errors.push(`Feedback error for ${shippingUnitId}: ${err instanceof Error ? err.message : 'unknown'}`)
        }
      }
    }

    console.log(`[sessionAnalyzer] Session ${sessionId}: ${result.feedbackRecorded} feedback entries recorded`)
  } catch (err) {
    result.errors.push(`Analysis error: ${err instanceof Error ? err.message : 'unknown'}`)
  }

  return result
}
