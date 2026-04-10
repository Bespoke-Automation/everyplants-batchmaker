import { NextRequest, NextResponse } from 'next/server'
import { getPackingSession, updatePackingSession, updateBox } from '@/lib/supabase/packingSessions'
import { fetchPicklist, getShipment } from '@/lib/picqer/client'
import { recordSessionOutcome } from '@/lib/engine/feedbackTracking'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions/[id]
 * Returns full session with boxes and products.
 * Syncs shipment status from Picqer to detect external cancellations.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getPackingSession(id)

    // Sync shipment status from Picqer for shipped boxes
    const shippedBoxes = session.packing_session_boxes.filter(
      b => b.shipment_id && (b.status === 'shipped' || b.status === 'label_fetched')
    )

    if (shippedBoxes.length > 0) {
      await Promise.allSettled(
        shippedBoxes.map(async (box) => {
          try {
            const picqerShipment = await getShipment(box.shipment_id!)
            if (picqerShipment.cancelled) {
              await updateBox(box.id, { status: 'cancelled' })
              box.status = 'cancelled'
            }
          } catch (err) {
            console.warn(`[verpakking] Failed to check shipment ${box.shipment_id} status:`, err)
          }
        })
      )
    }

    return NextResponse.json(session)
  } catch (error) {
    console.error('[verpakking] Error fetching packing session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packing session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/sessions/[id]
 * Updates a packing session with partial updates
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Whitelist allowed update fields
    const allowedFields: Record<string, unknown> = {}
    if (body.status !== undefined) allowedFields.status = body.status
    if (body.total_products !== undefined) allowedFields.total_products = body.total_products
    if (body.total_boxes !== undefined) allowedFields.total_boxes = body.total_boxes
    if (body.completed_at !== undefined) allowedFields.completed_at = body.completed_at

    if (Object.keys(allowedFields).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updatedSession = await updatePackingSession(id, allowedFields)

    // B5: If status is being set to 'completed', check if all products are packed
    // and record the engine-advice outcome for feedback tracking.
    let warning: string | undefined
    if (body.status === 'completed') {
      try {
        const sessionWithDetails = await getPackingSession(id)
        const picklist = await fetchPicklist(sessionWithDetails.picklist_id)
        const totalPicklistProducts = picklist.products.reduce((sum, p) => sum + p.amount, 0)
        const totalPackedProducts = sessionWithDetails.packing_session_boxes.reduce(
          (sum, box) => sum + box.packing_session_products.reduce((s, p) => s + p.amount, 0),
          0
        )

        if (totalPackedProducts !== totalPicklistProducts) {
          warning = `Let op: niet alle producten uit de picklist zijn ingepakt (${totalPackedProducts} van ${totalPicklistProducts})`
        }
      } catch (completenessError) {
        console.error('[verpakking] Error checking product completeness:', completenessError)
        // Non-blocking: don't fail the update
      }

      // Record feedback outcome (non-blocking). This path was previously missed
      // because the PUT completion flow bypassed tryCompleteSession entirely,
      // leaving ~66% of completed sessions without an outcome recorded.
      try {
        await recordSessionOutcome(id)
      } catch (feedbackError) {
        console.error('[verpakking] Error recording session outcome:', feedbackError)
      }
    }

    return NextResponse.json({ ...updatedSession, ...(warning && { warning }) })
  } catch (error) {
    console.error('[verpakking] Error updating packing session:', error)
    return NextResponse.json(
      { error: 'Failed to update packing session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
