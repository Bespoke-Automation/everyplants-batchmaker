import { inngest } from "../client"
import {
  getShipmentLabelsByBatch,
  updateShipmentLabel,
  updateSingleOrderBatch,
  getSingleOrderBatch,
  uploadPdfToStorage,
  ShipmentLabel,
} from "@/lib/supabase/shipmentLabels"
import {
  createShipment,
  getShipmentLabel,
  pickAllProducts,
  closePicklist,
} from "@/lib/picqer/client"
import {
  addPlantNameToLabel,
  detectCarrierFromShipment,
} from "@/lib/pdf/labelEditor"
import { combineLabelsFromStorage } from "@/lib/pdf/combineFromStorage"

interface BatchEventData {
  batchId: string
}

/**
 * Inngest function to process all shipment labels in a batch.
 * Uses step.run() for each label to enable checkpointing and automatic retries.
 */
export const processSingleOrderBatch = inngest.createFunction(
  {
    id: "process-single-order-batch",
    retries: 3,
  },
  { event: "batch/process.requested" },
  async ({ event, step }) => {
    const { batchId } = event.data as BatchEventData
    console.log(`[${batchId}] Inngest: Starting batch processing...`)

    // Step 1: Get batch configuration
    const batch = await step.run("get-batch-config", async () => {
      const b = await getSingleOrderBatch(batchId)
      if (!b) throw new Error(`Batch ${batchId} not found`)
      return {
        shippingProviderId: b.shipping_provider_id,
        packagingId: b.packaging_id,
        picqerBatchIds: b.picqer_batch_ids,
      }
    })

    // Step 2: Get all queued labels
    const queuedLabels = await step.run("get-queued-labels", async () => {
      const labels = await getShipmentLabelsByBatch(batchId)
      return labels.filter((l) => l.status === "queued")
    })

    if (queuedLabels.length === 0) {
      console.log(`[${batchId}] No queued labels to process`)
      return { success: true, message: "No labels to process" }
    }

    console.log(`[${batchId}] Processing ${queuedLabels.length} labels...`)

    // Track progress
    let successCount = 0
    let failCount = 0

    // Process each label as a separate step (enables checkpointing)
    for (const label of queuedLabels) {
      const result = await step.run(`process-label-${label.id}`, async () => {
        return await processLabel(label, batchId, batch.shippingProviderId, batch.packagingId)
      })

      if (result.success) {
        successCount++
      } else {
        failCount++
      }

      // Update batch progress after each label (for real-time polling)
      await step.run(`update-progress-${label.id}`, async () => {
        await updateSingleOrderBatch(batchId, {
          successful_shipments: successCount,
          failed_shipments: failCount,
        })
      })
    }

    // Combine all successful PDFs by fetching from storage
    // Wrapped in try/catch so finalize-batch always runs even if combining fails
    let combinedPdfUrl: string | null = null
    try {
      combinedPdfUrl = await step.run("combine-pdfs", async () => {
        return await combineAllPdfs(batchId)
      })
    } catch (error) {
      console.error(`[${batchId}] PDF combining failed, continuing to finalize:`, error)
    }

    // Update final batch status - count from actual label statuses to handle retries correctly
    const finalStatus = await step.run("finalize-batch", async () => {
      const allLabels = await getShipmentLabelsByBatch(batchId)
      const actualSuccess = allLabels.filter(l => l.status === "completed").length
      const actualFail = allLabels.filter(l => l.status === "error").length
      const status = actualFail === 0 ? "completed" : actualSuccess === 0 ? "failed" : "partial"

      await updateSingleOrderBatch(batchId, {
        status,
        successful_shipments: actualSuccess,
        failed_shipments: actualFail,
        combined_pdf_path: combinedPdfUrl,
      })

      return status
    })

    // Trigger webhook if configured
    const webhookUrl = process.env.N8N_BATCH_WEBHOOK_URL
    if (webhookUrl && successCount > 0) {
      await step.run("trigger-webhook", async () => {
        const webhookBody = {
          batchId,
          totalOrders: queuedLabels.length,
          successfulShipments: successCount,
          failedShipments: failCount,
          combinedPdfUrl,
          picqerBatchIds: batch.picqerBatchIds || [],
        }

        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookBody),
        })

        if (response.ok) {
          await updateSingleOrderBatch(batchId, { webhook_triggered: true })
          console.log(`[${batchId}] Webhook triggered successfully`)
        } else {
          console.error(`[${batchId}] Webhook failed: ${response.status}`)
        }
      })
    }

    console.log(`[${batchId}] Batch processing complete: ${successCount} success, ${failCount} failed`)

    return {
      success: true,
      batchId,
      totalProcessed: queuedLabels.length,
      successCount,
      failCount,
      combinedPdfUrl,
      status: finalStatus,
    }
  }
)

/**
 * Process a single shipment label
 */
async function processLabel(
  label: ShipmentLabel,
  batchId: string,
  shippingProviderId: number | null,
  packagingId: number | null
): Promise<{ success: boolean; error?: string }> {
  console.log(`[${batchId}] Processing label ${label.id} for picklist ${label.picklist_id}...`)

  try {
    // Update status to processing
    await updateShipmentLabel(label.id, { status: "pending" })

    // Create shipment in Picqer
    console.log(`[${batchId}] Creating shipment for picklist ${label.picklist_id}...`)
    const shipmentResult = await createShipment(
      label.picklist_id,
      shippingProviderId ?? undefined,
      packagingId
    )

    if (!shipmentResult.success || !shipmentResult.shipment) {
      throw new Error(shipmentResult.error || "Failed to create shipment")
    }

    const shipment = shipmentResult.shipment
    console.log(`[${batchId}] Shipment created: ${shipment.idshipment}`)

    // Update with shipment info
    await updateShipmentLabel(label.id, {
      status: "shipment_created",
      shipment_id: shipment.idshipment,
      tracking_code: shipment.trackingcode || null,
      original_label_url: shipment.labelurl_pdf || shipment.labelurl || null,
    })

    // Pick all products and close the picklist after successful shipment
    const pickResult = await pickAllProducts(label.picklist_id)
    if (!pickResult.success) {
      console.warn(`[${batchId}] Failed to pick all on picklist ${label.picklist_id}: ${pickResult.error}`)
    }

    const closeResult = await closePicklist(label.picklist_id)
    if (!closeResult.success) {
      console.warn(`[${batchId}] Failed to close picklist ${label.picklist_id}: ${closeResult.error}`)
      // Continue processing - don't fail the batch for close failures
    }

    // Fetch label PDF
    console.log(`[${batchId}] Fetching label PDF for shipment ${shipment.idshipment}...`)
    const labelResult = await getShipmentLabel(
      shipment.idshipment,
      shipment.labelurl_pdf || shipment.labelurl
    )

    if (!labelResult.success || !labelResult.labelData) {
      throw new Error(labelResult.error || "Failed to fetch label")
    }

    await updateShipmentLabel(label.id, { status: "label_fetched" })

    // Edit label (add plant name)
    let editedLabelBuffer = labelResult.labelData
    if (label.plant_name) {
      console.log(`[${batchId}] Adding plant name "${label.plant_name}" to label (country: ${label.country || 'NL'})...`)
      const carrierType = detectCarrierFromShipment(shipment)
      editedLabelBuffer = await addPlantNameToLabel(labelResult.labelData, label.plant_name, {
        carrier: carrierType,
        country: label.country || 'NL',
      })
    }

    await updateShipmentLabel(label.id, { status: "label_edited" })

    // Upload edited label to storage
    const labelFileName = `${label.order_reference || label.picklist_id}_label.pdf`
    const labelUrl = await uploadPdfToStorage(batchId, labelFileName, editedLabelBuffer)

    await updateShipmentLabel(label.id, {
      status: "completed",
      edited_label_path: labelUrl,
    })

    console.log(`[${batchId}] Label ${label.id} processed successfully`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    console.error(`[${batchId}] Error processing label ${label.id}:`, errorMessage)

    await updateShipmentLabel(label.id, {
      status: "error",
      error_message: errorMessage,
    })

    return { success: false, error: errorMessage }
  }
}

/**
 * Combine all successfully processed PDFs from storage (chunked)
 */
async function combineAllPdfs(batchId: string): Promise<string | null> {
  const labels = await getShipmentLabelsByBatch(batchId)
  const completedLabels = labels.filter((l) => l.status === "completed" && l.edited_label_path)

  const combinedPdf = await combineLabelsFromStorage(completedLabels, batchId)
  if (!combinedPdf) return null

  const combinedUrl = await uploadPdfToStorage(batchId, "combined_labels.pdf", combinedPdf)
  console.log(`[${batchId}] Combined PDF uploaded: ${combinedUrl}`)
  return combinedUrl
}
