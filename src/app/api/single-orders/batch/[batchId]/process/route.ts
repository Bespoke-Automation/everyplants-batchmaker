import { NextResponse } from 'next/server'
import {
  createShipment,
  getShipmentLabel,
  closePicklist,
} from '@/lib/picqer/client'
import {
  getShipmentLabelsByBatch,
  updateShipmentLabel,
  updateSingleOrderBatch,
  getSingleOrderBatch,
  uploadPdfToStorage,
} from '@/lib/supabase/shipmentLabels'
import {
  addPlantNameToLabel,
  combinePdfs,
  detectCarrierFromShipment,
  ProcessedLabel,
} from '@/lib/pdf/labelEditor'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max

/**
 * POST /api/single-orders/batch/[batchId]/process
 *
 * Processes all queued shipment labels for a batch:
 * 1. Creates shipments in Picqer
 * 2. Fetches and edits labels (adds plant name)
 * 3. Combines all labels into single PDF
 * 4. Uploads combined PDF to storage
 * 5. Updates batch status
 * 6. Triggers webhook if configured
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params

  if (!batchId) {
    return NextResponse.json(
      { error: 'Batch ID is required' },
      { status: 400 }
    )
  }

  console.log(`[${batchId}] Starting shipment processing...`)

  try {
    // Get batch config
    const batch = await getSingleOrderBatch(batchId)
    if (!batch) {
      console.error(`[${batchId}] Batch not found`)
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      )
    }

    const { shipping_provider_id: shippingProviderId, packaging_id: packagingId } = batch

    // Get all queued shipment labels
    const labels = await getShipmentLabelsByBatch(batchId)
    const queuedLabels = labels.filter(l => l.status === 'queued')

    console.log(`[${batchId}] Found ${queuedLabels.length} queued labels to process`)

    if (queuedLabels.length === 0) {
      console.log(`[${batchId}] No queued labels to process`)
      return NextResponse.json({
        success: true,
        message: 'No labels to process',
      })
    }

    const processedLabels: ProcessedLabel[] = []
    let successCount = 0
    let failCount = 0

    // Process each label
    for (const label of queuedLabels) {
      console.log(`[${batchId}] Processing label ${label.id} for picklist ${label.picklist_id}...`)

      try {
        // Update status to processing
        await updateShipmentLabel(label.id, { status: 'pending' })

        // Step 1: Create shipment in Picqer
        console.log(`[${batchId}] Creating shipment for picklist ${label.picklist_id}...`)
        const shipmentResult = await createShipment(
          label.picklist_id,
          shippingProviderId ?? undefined,
          packagingId
        )

        if (!shipmentResult.success || !shipmentResult.shipment) {
          throw new Error(shipmentResult.error || 'Failed to create shipment')
        }

        const shipment = shipmentResult.shipment
        console.log(`[${batchId}] Shipment created: ${shipment.idshipment}`)

        // Update label with shipment info
        await updateShipmentLabel(label.id, {
          status: 'shipment_created',
          shipment_id: shipment.idshipment,
          tracking_code: shipment.trackingcode || null,
          original_label_url: shipment.labelurl_pdf || shipment.labelurl || null,
        })

        // Close the picklist after successful shipment
        const closeResult = await closePicklist(label.picklist_id)
        if (!closeResult.success) {
          console.warn(`[${batchId}] Failed to close picklist ${label.picklist_id}: ${closeResult.error}`)
          // Continue processing - don't fail the batch for close failures
        }

        // Step 2: Fetch label PDF
        console.log(`[${batchId}] Fetching label PDF for shipment ${shipment.idshipment}...`)
        const labelResult = await getShipmentLabel(
          shipment.idshipment,
          shipment.labelurl_pdf || shipment.labelurl
        )

        if (!labelResult.success || !labelResult.labelData) {
          throw new Error(labelResult.error || 'Failed to fetch label')
        }

        await updateShipmentLabel(label.id, { status: 'label_fetched' })

        // Step 3: Edit label (add plant name)
        let editedLabelBuffer = labelResult.labelData
        if (label.plant_name) {
          console.log(`[${batchId}] Adding plant name "${label.plant_name}" to label (country: ${label.country || 'NL'})...`)
          // Log all provider-related fields for debugging
          console.log(`[${batchId}] Shipment provider fields: provider="${shipment.provider}", providername="${shipment.providername}", profile_name="${shipment.profile_name}", carrier_key="${shipment.carrier_key}"`)
          const carrierType = detectCarrierFromShipment(shipment)
          console.log(`[${batchId}] Detected carrier type: ${carrierType}`)
          editedLabelBuffer = await addPlantNameToLabel(
            labelResult.labelData,
            label.plant_name,
            { carrier: carrierType, country: label.country || 'NL' }
          )
        }

        await updateShipmentLabel(label.id, { status: 'label_edited' })

        // Step 4: Upload edited label to storage
        const labelFileName = `${label.order_reference || label.picklist_id}_label.pdf`
        const labelUrl = await uploadPdfToStorage(batchId, labelFileName, editedLabelBuffer)

        await updateShipmentLabel(label.id, {
          status: 'completed',
          edited_label_path: labelUrl,
        })

        processedLabels.push({
          success: true,
          pdfBuffer: editedLabelBuffer,
          orderId: label.order_id || 0,
          orderReference: label.order_reference || '',
          plantName: label.plant_name || '',
          retailer: label.retailer || '',
        })

        successCount++

        // Update batch record with progress (for real-time polling)
        console.log(`[${batchId}] Updating batch: successful_shipments=${successCount}`)
        await updateSingleOrderBatch(batchId, {
          successful_shipments: successCount,
        })
        console.log(`[${batchId}] Batch updated successfully`)

        console.log(`[${batchId}] Label ${label.id} processed successfully (${successCount}/${queuedLabels.length})`)

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[${batchId}] Error processing label ${label.id}:`, errorMessage)

        await updateShipmentLabel(label.id, {
          status: 'error',
          error_message: errorMessage,
        })

        processedLabels.push({
          success: false,
          orderId: label.order_id || 0,
          orderReference: label.order_reference || '',
          plantName: label.plant_name || '',
          retailer: label.retailer || '',
          error: errorMessage,
        })

        failCount++

        // Update batch record with progress (for real-time polling)
        await updateSingleOrderBatch(batchId, {
          failed_shipments: failCount,
        })
      }
    }

    // Step 5: Combine all successful PDFs
    let combinedPdfUrl: string | null = null
    const successfulPdfs = processedLabels
      .filter(l => l.success && l.pdfBuffer)
      .map(l => l.pdfBuffer!)

    if (successfulPdfs.length > 0) {
      console.log(`[${batchId}] Combining ${successfulPdfs.length} PDFs...`)
      try {
        const combinedPdf = await combinePdfs(successfulPdfs)
        combinedPdfUrl = await uploadPdfToStorage(batchId, 'combined_labels.pdf', combinedPdf)
        console.log(`[${batchId}] Combined PDF uploaded: ${combinedPdfUrl}`)
      } catch (error) {
        console.error(`[${batchId}] Error combining PDFs:`, error)
      }
    }

    // Step 6: Update batch status
    const finalStatus = failCount === 0 ? 'completed' : successCount === 0 ? 'failed' : 'partial'
    await updateSingleOrderBatch(batchId, {
      status: finalStatus,
      successful_shipments: successCount,
      failed_shipments: failCount,
      combined_pdf_path: combinedPdfUrl,
    })

    console.log(`[${batchId}] Batch processing complete: ${successCount} success, ${failCount} failed`)

    // Step 7: Trigger webhook if configured
    const webhookUrl = process.env.N8N_BATCH_WEBHOOK_URL
    if (webhookUrl && successCount > 0) {
      try {
        console.log(`[${batchId}] Triggering webhook...`)
        const webhookBody = {
          batchId,
          totalOrders: queuedLabels.length,
          successfulShipments: successCount,
          failedShipments: failCount,
          combinedPdfUrl,
          picqerBatchIds: batch.picqer_batch_ids || [],
        }

        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookBody),
        })

        if (webhookResponse.ok) {
          console.log(`[${batchId}] Webhook triggered successfully`)
          await updateSingleOrderBatch(batchId, { webhook_triggered: true })
        } else {
          console.error(`[${batchId}] Webhook failed: ${webhookResponse.status}`)
        }
      } catch (error) {
        console.error(`[${batchId}] Webhook error:`, error)
      }
    }

    return NextResponse.json({
      success: true,
      batchId,
      totalProcessed: queuedLabels.length,
      successCount,
      failCount,
      combinedPdfUrl,
      status: finalStatus,
    })

  } catch (error) {
    console.error(`[${batchId}] Fatal error during processing:`, error)

    // Try to update batch status to failed
    try {
      await updateSingleOrderBatch(batchId, { status: 'failed' })
    } catch {
      // Ignore update error
    }

    return NextResponse.json(
      {
        success: false,
        batchId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
