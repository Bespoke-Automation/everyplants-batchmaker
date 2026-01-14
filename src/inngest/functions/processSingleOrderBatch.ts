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
} from "@/lib/picqer/client"
import {
  addPlantNameToLabel,
  combinePdfs,
  detectCarrierFromShipment,
} from "@/lib/pdf/labelEditor"
import { supabase } from "@/lib/supabase/client"

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
    const combinedPdfUrl = await step.run("combine-pdfs", async () => {
      return await combineAllPdfs(batchId)
    })

    // Update final batch status
    const finalStatus = failCount === 0 ? "completed" : successCount === 0 ? "failed" : "partial"

    await step.run("finalize-batch", async () => {
      await updateSingleOrderBatch(batchId, {
        status: finalStatus,
        successful_shipments: successCount,
        failed_shipments: failCount,
        combined_pdf_path: combinedPdfUrl,
      })
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
      console.log(`[${batchId}] Adding plant name "${label.plant_name}" to label...`)
      const carrierType = detectCarrierFromShipment(shipment)
      editedLabelBuffer = await addPlantNameToLabel(labelResult.labelData, label.plant_name, {
        carrier: carrierType,
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
 * Combine all successfully processed PDFs from storage
 */
async function combineAllPdfs(batchId: string): Promise<string | null> {
  // Get all completed labels to find their PDF paths
  const labels = await getShipmentLabelsByBatch(batchId)
  const completedLabels = labels.filter((l) => l.status === "completed" && l.edited_label_path)

  if (completedLabels.length === 0) {
    console.log(`[${batchId}] No completed labels to combine`)
    return null
  }

  console.log(`[${batchId}] Combining ${completedLabels.length} PDFs...`)

  // Download all PDFs from storage
  const pdfBuffers: Buffer[] = []

  for (const label of completedLabels) {
    if (!label.edited_label_path) continue

    try {
      // Extract the path from the full URL
      const url = new URL(label.edited_label_path)
      const pathParts = url.pathname.split("/storage/v1/object/public/shipment-labels/")
      const filePath = pathParts[1]

      if (!filePath) {
        console.error(`[${batchId}] Could not extract file path from: ${label.edited_label_path}`)
        continue
      }

      const { data, error } = await supabase.storage.from("shipment-labels").download(filePath)

      if (error) {
        console.error(`[${batchId}] Error downloading PDF ${filePath}:`, error)
        continue
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      pdfBuffers.push(buffer)
    } catch (error) {
      console.error(`[${batchId}] Error processing PDF path:`, error)
    }
  }

  if (pdfBuffers.length === 0) {
    console.error(`[${batchId}] No PDFs could be downloaded for combining`)
    return null
  }

  // Combine all PDFs
  const combinedPdf = await combinePdfs(pdfBuffers)
  const combinedUrl = await uploadPdfToStorage(batchId, "combined_labels.pdf", combinedPdf)

  console.log(`[${batchId}] Combined PDF uploaded: ${combinedUrl}`)
  return combinedUrl
}
