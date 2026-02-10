import { NextRequest, NextResponse } from 'next/server'
import {
  getBoxesBySession,
  getPackingSession,
  updateBox,
  claimBoxForShipping,
} from '@/lib/supabase/packingSessions'
import { createShipment, getShipmentLabel } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

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
 * POST /api/verpakking/sessions/[id]/ship
 * Ships ONE box - creates shipment in Picqer and fetches label
 * Frontend calls this per box sequentially
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
    const { shippingProviderId, packagingId } = body

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

    // Step 5: Create shipment in Picqer
    const shipmentResult = await createShipment(
      session.picklist_id,
      shippingProviderId,
      packagingId || undefined
    )

    if (!shipmentResult.success || !shipmentResult.shipment) {
      // Update box status to error
      await updateBox(boxId, {
        status: 'error',
      })

      return NextResponse.json(
        {
          success: false,
          error: shipmentResult.error || 'Failed to create shipment',
        },
        { status: 500 }
      )
    }

    const shipment = shipmentResult.shipment
    const shipmentId = shipment.idshipment
    const trackingCode = shipment.trackingcode || undefined

    // Step 6: Fetch the shipping label
    let labelUrl: string | undefined
    const labelPdfUrl = shipment.labelurl_pdf || shipment.labelurl || undefined

    const labelResult = await getShipmentLabel(shipmentId, labelPdfUrl)

    if (labelResult.success && labelResult.labelData) {
      // Step 7: Upload label to Supabase Storage
      try {
        labelUrl = await uploadLabelToStorage(sessionId, boxId, labelResult.labelData)
      } catch (uploadError) {
        console.error('[verpakking] Failed to upload label to storage:', uploadError)
        // Continue without storage URL - we still have the Picqer label URL
        labelUrl = labelPdfUrl
      }
    } else {
      console.error('[verpakking] Failed to fetch label:', labelResult.error)
      // Use the Picqer label URL as fallback
      labelUrl = labelPdfUrl
    }

    // Step 8: Update box with shipment data
    await updateBox(boxId, {
      shipment_id: shipmentId,
      tracking_code: trackingCode || null,
      label_url: labelUrl || null,
      status: 'label_fetched',
    })

    return NextResponse.json({
      success: true,
      shipmentId,
      trackingCode: trackingCode || null,
      labelUrl: labelUrl || null,
    })
  } catch (error) {
    console.error('[verpakking] Error shipping box:', error)

    // Update box status to error if we have the boxId
    if (boxId) {
      try {
        await updateBox(boxId, {
          status: 'error',
        })
      } catch (updateError) {
        console.error('[verpakking] Failed to update box error status:', updateError)
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to ship box',
      },
      { status: 500 }
    )
  }
}
