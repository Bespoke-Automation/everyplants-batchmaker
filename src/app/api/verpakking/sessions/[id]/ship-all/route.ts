import { NextRequest, NextResponse } from 'next/server'
import {
  getBoxesBySession,
  getPackingSession,
  updateBox,
  claimBoxForShipping,
} from '@/lib/supabase/packingSessions'
import {
  createShipment,
  getShipmentLabel,
} from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'
import { tryAutoPrint } from '@/lib/printnode/autoPrint'
import { tryCompleteSession } from '@/lib/verpakking/tryCompleteSession'

export const dynamic = 'force-dynamic'

/** Negative IDs are local-only packagings that don't exist in Picqer */
function sanitizePackagingId(id: number | null | undefined): number | undefined {
  if (id == null || id < 0) return undefined
  return id
}

/**
 * Upload a PDF label to Supabase Storage
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
    console.error('[ship-all] Error uploading label to storage:', error)
    throw error
  }

  const { data: urlData } = supabase.storage
    .from('shipment-labels')
    .getPublicUrl(filePath)

  return urlData.publicUrl
}

interface BoxResult {
  boxId: string
  success: boolean
  trackingCode?: string | null
  trackingUrl?: string | null
  labelUrl?: string | null
  error?: string
}

/**
 * Process label in background with retries.
 * Box stays in 'shipment_created' if all retries fail — recoverable.
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
      const labelResult = await getShipmentLabel(shipmentId, labelPdfUrl)

      if (!labelResult.success || !labelResult.labelData) {
        console.error(`[ship-all-bg] Label download failed (attempt ${attempt + 1}):`, labelResult.error)
        if (attempt < MAX_RETRIES) continue
        await updateBox(boxId, { label_url: labelPdfUrl || null, status: 'label_fetched' })
        return
      }

      // Auto-print (non-blocking)
      tryAutoPrint(packingStationId, labelResult.labelData, shipmentId, boxId).catch((err) => {
        console.error('[ship-all-bg] Auto-print failed (non-blocking):', err)
      })

      // Upload to storage
      let labelUrl: string
      try {
        labelUrl = await uploadLabelToStorage(sessionId, boxId, labelResult.labelData)
      } catch {
        console.error(`[ship-all-bg] Storage upload failed (attempt ${attempt + 1})`)
        if (attempt < MAX_RETRIES) continue
        labelUrl = labelPdfUrl || ''
      }

      await updateBox(boxId, { label_url: labelUrl || null, status: 'label_fetched' })
      return
    } catch (err) {
      console.error(`[ship-all-bg] Unexpected error (attempt ${attempt + 1}):`, err)
      if (attempt >= MAX_RETRIES) {
        console.error(`[ship-all-bg] All retries exhausted for box ${boxId}, shipment ${shipmentId}. Box stays in shipment_created.`)
      }
    }
  }
}

/**
 * POST /api/verpakking/sessions/[id]/ship-all
 * Ships ALL closed boxes — creates shipments in Picqer in parallel,
 * responds immediately, then processes labels in background.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const body = await request.json()
    const { shippingProviderId, boxWeights, packingStationId, boxIds } = body

    if (!shippingProviderId) {
      return NextResponse.json(
        { error: 'Missing required field: shippingProviderId' },
        { status: 400 }
      )
    }

    // Step 1: Get session and unshipped boxes
    const session = await getPackingSession(sessionId)
    const allBoxes = await getBoxesBySession(sessionId)
    let closedBoxes = allBoxes.filter(b => b.status !== 'shipped' && b.status !== 'error' && b.status !== 'label_fetched' && b.status !== 'shipment_created')

    // If specific boxIds provided, only ship those
    if (boxIds && Array.isArray(boxIds) && boxIds.length > 0) {
      const idSet = new Set(boxIds as string[])
      closedBoxes = closedBoxes.filter(b => idSet.has(b.id))
    }

    if (closedBoxes.length === 0) {
      return NextResponse.json(
        { error: 'Geen dozen om te verzenden' },
        { status: 400 }
      )
    }

    const weights = boxWeights as Record<string, number> | undefined
    const results: BoxResult[] = []
    const shipmentMap = new Map<string, number>() // boxId → shipmentId
    let sessionCompleted = false
    let closeWarning: string | undefined

    console.log(`[ship-all] Shipping ${closedBoxes.length} boxes`)

    // Phase 1: Claim all boxes serially (atomic locks)
    const boxesToShip: typeof closedBoxes = []
    for (const box of closedBoxes) {
      if (box.shipment_id) {
        results.push({
          boxId: box.id,
          success: true,
          trackingCode: box.tracking_code,
          labelUrl: box.label_url,
        })
        continue
      }

      const claimed = await claimBoxForShipping(box.id)
      if (!claimed) {
        results.push({ boxId: box.id, success: false, error: 'Box is al geclaimd door een ander proces' })
        continue
      }
      boxesToShip.push(box)
    }

    // Phase 2: Create shipments in parallel (only Picqer createShipment — no label fetching)
    if (boxesToShip.length > 0) {
      const shipResults = await Promise.allSettled(
        boxesToShip.map(box =>
          createShipmentForBox(
            sessionId, session.picklist_id, box.id,
            shippingProviderId, sanitizePackagingId(box.picqer_packaging_id),
            weights?.[box.id], shipmentMap
          )
        )
      )

      for (let i = 0; i < shipResults.length; i++) {
        const result = shipResults[i]
        if (result.status === 'fulfilled') {
          results.push(result.value)
        } else {
          results.push({
            boxId: boxesToShip[i].id,
            success: false,
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
          })
        }
      }
    }

    // Phase 3: Fire background label processing for all successful shipments
    // shipmentMap was populated by createShipmentForBox during Phase 2
    for (const box of results) {
      const sId = shipmentMap.get(box.boxId)
      if (box.success && sId) {
        processLabelInBackground(
          sessionId, box.boxId, sId, box.labelUrl || undefined, packingStationId
        ).catch((err) => {
          console.error(`[ship-all] Background label processing failed for box ${box.boxId}:`, err)
        })
      }
    }

    // Step 3: Try to complete session
    try {
      const completionResult = await tryCompleteSession(sessionId, session.picklist_id)
      sessionCompleted = completionResult.sessionCompleted
      if (completionResult.warning) {
        closeWarning = (closeWarning || '') + completionResult.warning
      }

      return NextResponse.json({
        boxes: results,
        sessionCompleted,
        ...(closeWarning && { warning: closeWarning }),
        ...(completionResult.outcome && { outcome: completionResult.outcome, deviationType: completionResult.deviationType }),
      })
    } catch (e) {
      console.error('[ship-all] Error checking session completion:', e)
    }

    return NextResponse.json({
      boxes: results,
      sessionCompleted,
      ...(closeWarning && { warning: closeWarning }),
    })
  } catch (error) {
    console.error('[ship-all] Error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to ship all boxes',
      },
      { status: 500 }
    )
  }
}

/**
 * Create shipment in Picqer and save to DB — NO label fetching.
 * Returns immediately with Picqer label URL for frontend display.
 */
async function createShipmentForBox(
  sessionId: string,
  picklistId: number,
  boxId: string,
  shippingProviderId: number,
  packagingId?: number,
  weight?: number,
  shipmentMap?: Map<string, number>,
): Promise<BoxResult> {
  try {
    const shipmentResult = await createShipment(
      picklistId,
      shippingProviderId,
      packagingId,
      weight
    )

    if (!shipmentResult.success || !shipmentResult.shipment) {
      await updateBox(boxId, { status: 'error' })
      return {
        boxId,
        success: false,
        error: shipmentResult.error || 'Failed to create shipment',
      }
    }

    const shipment = shipmentResult.shipment
    const trackingCode = shipment.trackingcode ?? null
    const trackingUrl = shipment.trackingurl ?? shipment.tracktraceurl ?? null
    const labelPdfUrl = shipment.labelurl_pdf ?? shipment.labelurl ?? undefined

    // Save shipment data immediately (status = shipment_created, not label_fetched)
    await updateBox(boxId, {
      shipment_id: shipment.idshipment,
      tracking_code: trackingCode,
      tracking_url: trackingUrl,
      label_url: labelPdfUrl || null,
      shipped_at: new Date().toISOString(),
      status: 'shipment_created',
    })

    // Track shipment ID for background label processing
    shipmentMap?.set(boxId, shipment.idshipment)

    return {
      boxId,
      success: true,
      trackingCode,
      trackingUrl,
      labelUrl: labelPdfUrl || null,
    }
  } catch (error) {
    await updateBox(boxId, { status: 'error' }).catch(() => {})
    return {
      boxId,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
