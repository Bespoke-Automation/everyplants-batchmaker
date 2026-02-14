import { NextRequest, NextResponse } from 'next/server'
import {
  getBoxesBySession,
  getPackingSession,
  updateBox,
  updatePackingSession,
  claimBoxForShipping,
} from '@/lib/supabase/packingSessions'
import {
  createShipment,
  createMulticolloShipment,
  getShipmentLabel,
  pickAllProducts,
  closePicklist,
  fetchPicklist,
} from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'
import type { PicqerShipmentParcel } from '@/lib/picqer/types'
import { recordSessionOutcome } from '@/lib/engine/feedbackTracking'

export const dynamic = 'force-dynamic'

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
 * Ships ALL closed boxes. Auto-detects multicollo eligibility.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const body = await request.json()
    const { shippingProviderId, boxWeights } = body

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

    // Step 2: Detect multicollo eligibility
    // All boxes must have the same picqer_packaging_id and same weight
    const weights = boxWeights as Record<string, number> | undefined
    let isMulticollo = false

    if (closedBoxes.length >= 2) {
      const firstBox = closedBoxes[0]
      const firstPackagingId = firstBox.picqer_packaging_id
      const firstWeight = weights?.[firstBox.id] ?? null

      if (firstPackagingId && firstWeight) {
        isMulticollo = closedBoxes.every(box => {
          const boxWeight = weights?.[box.id] ?? null
          return box.picqer_packaging_id === firstPackagingId && boxWeight === firstWeight
        })
      }
    }

    const results: BoxResult[] = []
    let sessionCompleted = false
    let closeWarning: string | undefined

    if (isMulticollo) {
      // === MULTICOLLO PATH ===
      console.log(`[ship-all] Multicollo detected: ${closedBoxes.length} boxes with same packaging and weight`)

      // Claim all boxes first
      const claimResults = await Promise.all(
        closedBoxes.map(async (box) => ({
          boxId: box.id,
          claimed: await claimBoxForShipping(box.id),
        }))
      )

      const failedClaims = claimResults.filter(r => !r.claimed)
      if (failedClaims.length > 0) {
        // Some boxes couldn't be claimed — fall through to individual
        console.warn(`[ship-all] ${failedClaims.length} boxes couldn't be claimed, falling back to individual`)
        for (const fc of failedClaims) {
          results.push({ boxId: fc.boxId, success: false, error: 'Box is al geclaimd door een ander proces' })
        }
      }

      const claimedBoxes = closedBoxes.filter(box =>
        claimResults.find(r => r.boxId === box.id)?.claimed
      )

      if (claimedBoxes.length >= 2) {
        // Build parcels array
        const parcels = claimedBoxes.map(box => ({
          idpackaging: box.picqer_packaging_id!,
          weight: weights?.[box.id] ?? 0,
        }))

        const shipmentResult = await createMulticolloShipment(
          session.picklist_id,
          shippingProviderId,
          parcels
        )

        if (shipmentResult.success && shipmentResult.shipment) {
          const shipment = shipmentResult.shipment
          const shipmentParcels = shipment.parcels ?? []

          // Map each parcel to its box
          for (let i = 0; i < claimedBoxes.length; i++) {
            const box = claimedBoxes[i]
            const parcel: PicqerShipmentParcel | undefined = shipmentParcels[i]

            const trackingCode = parcel?.trackingcode ?? shipment.trackingcode ?? null
            const trackingUrl = shipment.trackingurl ?? shipment.tracktraceurl ?? undefined
            const labelPdfUrl = parcel?.labelurl_pdf ?? parcel?.labelurl ?? shipment.labelurl_pdf ?? shipment.labelurl ?? undefined

            // Fetch and upload label
            let labelUrl: string | undefined
            if (parcel?.idshipment_parcel) {
              const labelResult = await getShipmentLabel(shipment.idshipment, labelPdfUrl)
              if (labelResult.success && labelResult.labelData) {
                try {
                  labelUrl = await uploadLabelToStorage(sessionId, box.id, labelResult.labelData)
                } catch {
                  labelUrl = labelPdfUrl
                }
              } else {
                labelUrl = labelPdfUrl
              }
            } else {
              labelUrl = labelPdfUrl
            }

            // Update box in Supabase
            await updateBox(box.id, {
              shipment_id: shipment.idshipment,
              tracking_code: trackingCode,
              tracking_url: trackingUrl || null,
              label_url: labelUrl || null,
              shipped_at: new Date().toISOString(),
              status: 'label_fetched',
            })

            results.push({
              boxId: box.id,
              success: true,
              trackingCode,
              trackingUrl: trackingUrl || null,
              labelUrl: labelUrl || null,
            })
          }
        } else {
          // Multicollo failed — mark all claimed boxes as error
          for (const box of claimedBoxes) {
            await updateBox(box.id, { status: 'error' })
            results.push({
              boxId: box.id,
              success: false,
              error: shipmentResult.error || 'Multicollo zending mislukt',
            })
          }
        }
      } else if (claimedBoxes.length === 1) {
        // Only 1 box claimed — ship individually
        const box = claimedBoxes[0]
        const result = await shipSingleBox(
          sessionId, session.picklist_id, box.id,
          shippingProviderId, box.picqer_packaging_id ?? undefined,
          weights?.[box.id]
        )
        results.push(result)
      }
    } else {
      // === INDIVIDUAL PATH ===
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
          shippingProviderId, box.picqer_packaging_id ?? undefined,
          weights?.[box.id]
        )
        results.push(result)
      }
    }

    // Step 3: Check if all boxes shipped → close picklist + complete session
    try {
      const updatedBoxes = await getBoxesBySession(sessionId)
      const allBoxesShipped = updatedBoxes.length > 0 && updatedBoxes.every(
        b => b.status === 'label_fetched' || b.status === 'shipped'
      )

      if (allBoxesShipped) {
        // Check product completeness
        try {
          const picklist = await fetchPicklist(session.picklist_id)
          const totalPicklistProducts = picklist.products.reduce((sum, p) => sum + p.amount, 0)
          const sessionWithProducts = await getPackingSession(sessionId)
          const totalPackedProducts = sessionWithProducts.packing_session_boxes.reduce(
            (sum, box) => sum + box.packing_session_products.reduce((s, p) => s + p.amount, 0),
            0
          )
          if (totalPackedProducts !== totalPicklistProducts) {
            closeWarning = `Let op: niet alle producten uit de picklist zijn ingepakt (${totalPackedProducts} van ${totalPicklistProducts}). `
          }
        } catch (e) {
          console.error('[ship-all] Error checking product completeness:', e)
        }

        // Pick all products
        try {
          await pickAllProducts(session.picklist_id)
        } catch (e) {
          console.error('[ship-all] Failed to pick all products:', e)
          closeWarning = (closeWarning || '') + 'Failed to pick all products in Picqer. '
        }

        // Close picklist
        try {
          const closeResult = await closePicklist(session.picklist_id)
          if (!closeResult.success) {
            closeWarning = (closeWarning || '') + `Picklist close failed: ${closeResult.error}. `
          }
        } catch (e) {
          console.error('[ship-all] Error closing picklist:', e)
          closeWarning = (closeWarning || '') + `Picklist close error. `
        }

        // Complete session
        await updatePackingSession(sessionId, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        sessionCompleted = true

        // Record feedback loop data (non-blocking)
        try {
          await recordSessionOutcome(sessionId)
        } catch (feedbackError) {
          console.error('[ship-all] Error recording session outcome:', feedbackError)
        }
      }
    } catch (e) {
      console.error('[ship-all] Error checking session completion:', e)
    }

    return NextResponse.json({
      boxes: results,
      multicollo: isMulticollo,
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
 * Ship a single box — same logic as the existing /ship POST endpoint
 */
async function shipSingleBox(
  sessionId: string,
  picklistId: number,
  boxId: string,
  shippingProviderId: number,
  packagingId?: number,
  weight?: number,
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
