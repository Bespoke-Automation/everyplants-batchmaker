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
 * POST /api/verpakking/sessions/[id]/ship-all
 * Ships ALL closed boxes — each box gets its own individual shipment.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const body = await request.json()
    const { shippingProviderId, boxWeights, packingStationId } = body

    if (!shippingProviderId) {
      return NextResponse.json(
        { error: 'Missing required field: shippingProviderId' },
        { status: 400 }
      )
    }

    // Step 1: Get session and closed boxes
    const session = await getPackingSession(sessionId)
    const allBoxes = await getBoxesBySession(sessionId)
    const closedBoxes = allBoxes.filter(b => b.status === 'closed')

    if (closedBoxes.length === 0) {
      return NextResponse.json(
        { error: 'Geen afgesloten dozen om te verzenden' },
        { status: 400 }
      )
    }

    const weights = boxWeights as Record<string, number> | undefined
    const results: BoxResult[] = []
    let sessionCompleted = false
    let closeWarning: string | undefined

    // Ship each box individually — 1 box = 1 shipment = 1 label
    console.log(`[ship-all] Individual shipping: ${closedBoxes.length} boxes`)

    for (const box of closedBoxes) {
      // Skip boxes that already have a shipment
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

      const result = await shipSingleBox(
        sessionId, session.picklist_id, box.id,
        shippingProviderId, sanitizePackagingId(box.picqer_packaging_id),
        weights?.[box.id], packingStationId
      )
      results.push(result)
    }

    // Step 2: Try to complete session (only if all products are packed)
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
 * Ship a single box — creates individual shipment in Picqer and fetches label
 */
async function shipSingleBox(
  sessionId: string,
  picklistId: number,
  boxId: string,
  shippingProviderId: number,
  packagingId?: number,
  weight?: number,
  packingStationId?: string,
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

    // Fetch label
    let labelUrl: string | undefined
    const labelResult = await getShipmentLabel(shipment.idshipment, labelPdfUrl)
    if (labelResult.success && labelResult.labelData) {
      try {
        labelUrl = await uploadLabelToStorage(sessionId, boxId, labelResult.labelData)
      } catch {
        labelUrl = labelPdfUrl
      }
      // Auto-print via PrintNode (non-blocking)
      tryAutoPrint(packingStationId, labelResult.labelData, shipment.idshipment, boxId).catch((err) => {
        console.error('[verpakking] Auto-print failed (non-blocking):', err)
      })
    } else {
      labelUrl = labelPdfUrl
    }

    // Update box
    await updateBox(boxId, {
      shipment_id: shipment.idshipment,
      tracking_code: trackingCode,
      tracking_url: trackingUrl,
      label_url: labelUrl || null,
      shipped_at: new Date().toISOString(),
      status: 'label_fetched',
    })

    return {
      boxId,
      success: true,
      trackingCode,
      trackingUrl,
      labelUrl: labelUrl || null,
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
