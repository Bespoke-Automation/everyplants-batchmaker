import { NextRequest, NextResponse } from 'next/server'
import { getPackingSession, updateBox } from '@/lib/supabase/packingSessions'
import { supabase } from '@/lib/supabase/client'
import { getShipment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 1. Get session with boxes and products
    const session = await getPackingSession(id)

    // 2. Sync shipment status from Picqer for shipped boxes
    // Detect cancellations made in Picqer UI
    const shippedBoxes = session.packing_session_boxes.filter(
      b => b.shipment_id && (b.status === 'shipped' || b.status === 'label_fetched')
    )

    if (shippedBoxes.length > 0) {
      const syncResults = await Promise.allSettled(
        shippedBoxes.map(async (box) => {
          try {
            const picqerShipment = await getShipment(box.shipment_id!)
            if (picqerShipment.cancelled) {
              await updateBox(box.id, { status: 'cancelled' })
              box.status = 'cancelled'
            }
          } catch (err) {
            console.warn(`[session/details] Failed to check shipment ${box.shipment_id} status:`, err)
          }
        })
      )
      // Log any sync failures (non-blocking)
      const failures = syncResults.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        console.warn(`[session/details] ${failures.length} shipment status checks failed`)
      }
    }

    // 3. Find packaging advice if any box has a packaging_advice_id
    const adviceId = session.packing_session_boxes
      .map(b => b.packaging_advice_id)
      .find(id => id != null)

    let advice = null
    if (adviceId) {
      const { data } = await supabase
        .schema('batchmaker')
        .from('packaging_advice')
        .select('id, confidence, advice_boxes, outcome, deviation_type, weight_exceeded, calculated_at')
        .eq('id', adviceId)
        .single()
      advice = data
    }

    // 4. Format response
    return NextResponse.json({
      session: {
        id: session.id,
        picklist_id: session.picklist_id,
        picklistid: session.picklistid,
        order_id: session.order_id,
        order_reference: session.order_reference,
        assigned_to_name: session.assigned_to_name,
        status: session.status,
        created_at: session.created_at,
        completed_at: session.completed_at,
        boxes: session.packing_session_boxes.map(box => ({
          id: box.id,
          packaging_name: box.packaging_name,
          box_index: box.box_index,
          status: box.status,
          was_override: box.was_override,
          suggested_packaging_name: box.suggested_packaging_name,
          tracking_code: box.tracking_code,
          shipped_at: box.shipped_at,
          products: box.packing_session_products.map(p => ({
            productcode: p.productcode,
            product_name: p.product_name,
            amount: p.amount,
          })),
        })),
      },
      advice,
    })
  } catch (error) {
    console.error('[session/details] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch session details' },
      { status: 500 }
    )
  }
}
