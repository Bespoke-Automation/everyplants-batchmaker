import { NextRequest, NextResponse } from 'next/server'
import {
  getBoxesBySession,
  getPackingSession,
  updateBox,
  updatePackingSession,
  claimBoxForShipping,
} from '@/lib/supabase/packingSessions'
import { createShipment, getShipmentLabel, cancelShipment } from '@/lib/picqer/client'
import { tryCompleteSession } from '@/lib/verpakking/tryCompleteSession'
import { supabase } from '@/lib/supabase/client'
import { logActivity } from '@/lib/supabase/activityLog'
import { getRequestUser } from '@/lib/supabase/getRequestUser'
import { tryAutoPrint } from '@/lib/printnode/autoPrint'
import { triggerShopifyTrackingSync } from '@/inngest/functions/syncShopifyTracking'

export const dynamic = 'force-dynamic'

/** Negative IDs are local-only packagings that don't exist in Picqer */
function sanitizePackagingId(id: number | null | undefined): number | undefined {
  if (id == null || id < 0) return undefined
  return id
}

/**
 * Upload a PDF label to Supabase Storage
 * Reuses the pattern from shipmentLabels.ts uploadPdfToStorage
 */
async function uploadLabelToStorage(
  sessionId: string,
  boxId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const filePath = `verpakking/${sessionId}/${boxId}.pdf`

  const { error } = await supabase.storage
    .from('shipment-labels')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) {
    console.error('[verpakking] Error uploading label to storage:', error)
    throw error
  }

  const { data: urlData } = supabase.storage
    .from('shipment-labels')
    .getPublicUrl(filePath)

  return urlData.publicUrl
}

/**
 * Process label in background: download, upload to storage, auto-print, update box.
 * Retries up to 2 times on failure. Box stays in 'shipment_created' if all retries fail
 * so it can be recovered later (shipment exists in Picqer, data is not lost).
 */
async function processLabelInBackground(
  sessionId: string,
  boxId: string,
  shipmentId: number,
  labelPdfUrl: string | undefined,
  packingStationId: string | undefined,
) {
  const MAX_RETRIES = 2

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Download label PDF
      const labelResult = await getShipmentLabel(shipmentId, labelPdfUrl)

      if (!labelResult.success || !labelResult.labelData) {
        console.error(`[ship-bg] Label download failed (attempt ${attempt + 1}):`, labelResult.error)
        if (attempt < MAX_RETRIES) continue
        // Final attempt failed — update box with Picqer URL as fallback
        await updateBox(boxId, { label_url: labelPdfUrl || null, status: 'label_fetched' })
        return
      }

      // Auto-print (non-blocking, fire-and-forget)
      tryAutoPrint(packingStationId, labelResult.labelData, shipmentId, boxId).catch((err) => {
        console.error('[ship-bg] Auto-print failed (non-blocking):', err)
      })

      // Upload to Supabase Storage
      let labelUrl: string
      try {
        labelUrl = await uploadLabelToStorage(sessionId, boxId, labelResult.labelData)
      } catch {
        console.error(`[ship-bg] Storage upload failed (attempt ${attempt + 1})`)
        if (attempt < MAX_RETRIES) continue
        // Use Picqer URL as fallback
        labelUrl = labelPdfUrl || ''
      }

      // Update box with permanent label URL
      await updateBox(boxId, { label_url: labelUrl || null, status: 'label_fetched' })
      return
    } catch (err) {
      console.error(`[ship-bg] Unexpected error (attempt ${attempt + 1}):`, err)
      if (attempt >= MAX_RETRIES) {
        // Final failure — box stays in 'shipment_created', recoverable
        console.error(`[ship-bg] All retries exhausted for box ${boxId}, shipment ${shipmentId}. Box stays in shipment_created for recovery.`)
      }
    }
  }
}

/**
 * POST /api/verpakking/sessions/[id]/ship
 * Ships ONE box — creates shipment in Picqer, responds immediately,
 * then processes label download/upload/print in background.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  let boxId: string | undefined

  try {
    const body = await request.json()
    boxId = body.boxId
    const { shippingProviderId, packagingId, weight, packingStationId } = body

    if (!boxId || !shippingProviderId) {
      return NextResponse.json(
        { error: 'Missing required fields: boxId, shippingProviderId' },
        { status: 400 }
      )
    }

    // Step 1: Get the box from Supabase
    const boxes = await getBoxesBySession(sessionId)
    const box = boxes.find(b => b.id === boxId)

    if (!box) {
      return NextResponse.json(
        { error: `Box ${boxId} not found in session ${sessionId}` },
        { status: 404 }
      )
    }

    // Step 2: Idempotency check - if box already has a shipment, return cached result
    if (box.shipment_id) {
      return NextResponse.json({
        success: true,
        shipmentId: box.shipment_id,
        trackingCode: box.tracking_code || null,
        trackingUrl: box.tracking_url || null,
        labelUrl: box.label_url || null,
      })
    }

    // Step 3: Atomic claim - only succeeds if box is still in 'pending' or 'open' status
    const claimed = await claimBoxForShipping(boxId)
    if (!claimed) {
      return NextResponse.json(
        { success: false, error: 'Box is already being shipped or has been shipped' },
        { status: 409 }
      )
    }

    // Step 4: Get the session to get picklistId
    const session = await getPackingSession(sessionId)

    // Step 5: Create shipment in Picqer (the only blocking Picqer call)
    const shipmentResult = await createShipment(
      session.picklist_id,
      shippingProviderId,
      sanitizePackagingId(packagingId),
      weight || undefined
    )

    if (!shipmentResult.success || !shipmentResult.shipment) {
      await updateBox(boxId, { status: 'error' })

      let userError = shipmentResult.error || 'Failed to create shipment'
      if (userError.includes('Packaging not found') || userError.includes('error_code":26') || userError.includes('error_code\\":26')) {
        userError = `Verpakking niet gevonden in Picqer (ID: ${packagingId}). Synchroniseer verpakkingen opnieuw via Instellingen.`
      }

      return NextResponse.json({ success: false, error: userError }, { status: 500 })
    }

    const shipment = shipmentResult.shipment
    const shipmentId = shipment.idshipment
    const trackingCode = shipment.trackingcode || undefined
    const trackingUrl = shipment.trackingurl || shipment.tracktraceurl || undefined
    const labelPdfUrl = shipment.labelurl_pdf || shipment.labelurl || undefined

    // Step 6: Save shipment data immediately (status = shipment_created)
    await updateBox(boxId, {
      shipment_id: shipmentId,
      tracking_code: trackingCode || null,
      tracking_url: trackingUrl || null,
      label_url: labelPdfUrl || null,
      shipped_at: new Date().toISOString(),
      status: 'shipment_created',
    })

    // Step 7: Process label in background (download → storage → print → update to label_fetched)
    // This does NOT block the response to the frontend
    processLabelInBackground(sessionId, boxId, shipmentId, labelPdfUrl, packingStationId).catch((err) => {
      console.error('[verpakking] Background label processing failed:', err)
    })

    // Step 7b: Trigger Shopify tracking sync (debounced at Inngest side). Fires on every
    // single-box ship — the Inngest function itself checks if >=2 shipments exist before
    // patching. Debounce 10s groups multiple individual ship calls into one sync run.
    triggerShopifyTrackingSync(session.picklist_id, 'ship-single').catch(err => {
      console.error(`[verpakking] Failed to trigger Shopify tracking sync for picklist ${session.picklist_id}:`, err)
    })

    // Step 8: Try to complete session
    let sessionCompleted = false
    let closeWarning: string | undefined
    let outcomeData: { outcome: string; deviationType: string } | undefined
    try {
      const result = await tryCompleteSession(sessionId, session.picklist_id)
      sessionCompleted = result.sessionCompleted
      closeWarning = result.warning
      if (result.outcome) outcomeData = { outcome: result.outcome, deviationType: result.deviationType! }

      if (sessionCompleted) {
        const user = await getRequestUser()
        await logActivity({
          user_id: user?.id,
          user_email: user?.email,
          user_name: user?.name,
          action: 'session.completed',
          module: 'verpakkingsmodule',
          description: `Inpaksessie afgerond (picklist ${session.picklist_id})`,
          metadata: { session_id: sessionId, picklist_id: session.picklist_id },
        })
      }
    } catch (completionError) {
      console.error('[verpakking] Error checking session completion:', completionError)
    }

    return NextResponse.json({
      success: true,
      shipmentId,
      trackingCode: trackingCode || null,
      trackingUrl: trackingUrl || null,
      labelUrl: labelPdfUrl || null,
      sessionCompleted,
      ...(closeWarning && { warning: closeWarning }),
      ...(outcomeData && { outcome: outcomeData.outcome, deviationType: outcomeData.deviationType }),
    })
  } catch (error) {
    console.error('[verpakking] Error shipping box:', error)

    if (boxId) {
      try {
        await updateBox(boxId, { status: 'error' })
      } catch (updateError) {
        console.error('[verpakking] Failed to update box error status:', updateError)
      }
    }

    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to ship box' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/sessions/[id]/ship
 * Cancel a shipment for a box (within 5-minute window)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const body = await request.json()
    const { boxId } = body

    if (!boxId) {
      return NextResponse.json(
        { error: 'Missing required field: boxId' },
        { status: 400 }
      )
    }

    // Step 1: Get the box
    const boxes = await getBoxesBySession(sessionId)
    const box = boxes.find(b => b.id === boxId)

    if (!box) {
      return NextResponse.json(
        { error: `Box ${boxId} not found in session ${sessionId}` },
        { status: 404 }
      )
    }

    if (!box.shipment_id) {
      return NextResponse.json(
        { error: 'Box has no shipment to cancel' },
        { status: 400 }
      )
    }

    // Get session for picklist_id
    const session = await getPackingSession(sessionId)

    // Step 3: Try to cancel shipment in Picqer (best-effort)
    // Picqer does not expose shipment cancel via REST API, so this may fail.
    // The worker should cancel in Picqer UI separately if needed.
    try {
      const cancelResult = await cancelShipment(session.picklist_id, box.shipment_id)
      if (!cancelResult.success) {
        console.warn(`[verpakking] Picqer cancel not available via API — cancel in Picqer UI if needed: ${cancelResult.error}`)
      }
    } catch (e) {
      console.warn('[verpakking] Picqer cancel call failed (non-blocking):', e)
    }

    // Step 4: Log cancellation to database
    await supabase
      .schema('batchmaker')
      .from('shipment_cancellations')
      .insert({
        session_id: sessionId,
        box_id: boxId,
        picklist_id: session.picklist_id,
        shipment_id: box.shipment_id,
        tracking_code: box.tracking_code,
        packaging_name: box.packaging_name,
        cancelled_by: body.cancelledBy || null,
        reason: body.reason || null,
      })

    // Step 5: Reset box in Supabase (always proceed regardless of Picqer result)
    await updateBox(boxId, {
      shipment_id: null,
      tracking_code: null,
      tracking_url: null,
      label_url: null,
      shipped_at: null,
      status: 'closed',
    })

    // Step 5: If session was completed, reopen it
    let sessionReopened = false
    try {
      const currentSession = await getPackingSession(sessionId)
      if (currentSession.status === 'completed') {
        await updatePackingSession(sessionId, {
          status: 'shipping',
          completed_at: null,
        })
        sessionReopened = true

        // Invalidate the previous outcome (will be re-computed on next completion)
        const adviceId = currentSession.packing_session_boxes
          .map(b => b.packaging_advice_id)
          .find(id => id != null)
        if (adviceId) {
          await supabase
            .schema('batchmaker')
            .from('packaging_advice')
            .update({ outcome: null, actual_boxes: null, deviation_type: null, resolved_at: null })
            .eq('id', adviceId)
        }
      }
    } catch (reopenError) {
      console.error('[verpakking] Error reopening session after cancel:', reopenError)
    }

    return NextResponse.json({ success: true, sessionReopened })
  } catch (error) {
    console.error('[verpakking] Error cancelling shipment:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel shipment',
      },
      { status: 500 }
    )
  }
}
