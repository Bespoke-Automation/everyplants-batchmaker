import { NextResponse } from 'next/server'
import { createShipment, getShipmentLabel, createPicklistBatch, fetchPicklist } from '@/lib/picqer/client'
import { addPlantNameToLabel, sortAndCombineLabels, ProcessedLabel, getCarrierFromProviderName } from '@/lib/pdf/labelEditor'
import {
  createShipmentLabel,
  updateShipmentLabel,
  createSingleOrderBatch,
  updateSingleOrderBatch,
  uploadPdfToStorage,
} from '@/lib/supabase/shipmentLabels'
import { PicqerPicklistWithProducts } from '@/lib/picqer/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max for processing many shipments

interface OrderInGroup {
  id: number
  reference: string
  idPicklist: number
  retailerName: string
  idShippingProvider: number | null
}

interface ProductGroupInput {
  productId: number
  productCode: string
  productName: string
  orders: OrderInGroup[]
}

interface BatchRequestBody {
  productGroups: ProductGroupInput[]
  idShippingProvider?: number  // Override shipping provider for all orders
  idPackaging?: number | null  // Packaging to use for all shipments
}

interface BatchError {
  orderId: number
  orderReference: string
  error: string
}

interface ValidatedPicklist {
  picklistId: number
  warehouseId: number
  status: string
  order: OrderInGroup
  productGroup: ProductGroupInput
}

/**
 * Generate a unique batch ID
 */
function generateBatchId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `SO-${timestamp}-${random}`.toUpperCase()
}

/**
 * POST /api/single-orders/batch
 *
 * Creates shipments and labels for selected single order groups.
 *
 * New Flow (v2):
 * 1. Pre-validate all picklists (fetch status and warehouse)
 * 2. Group picklists by warehouse
 * 3. Create Picqer batch for each warehouse group (fail all if any fails)
 * 4. Create shipments for each order's picklist via Picqer API
 * 5. Fetch shipping labels from Picqer
 * 6. Edit labels to include plant name
 * 7. Combine into single PDF sorted by product → retailer
 * 8. Save to Supabase storage
 * 9. Trigger n8n webhook
 */
export async function POST(request: Request) {
  const batchId = generateBatchId()
  console.log(`[${batchId}] Starting single order batch creation...`)

  try {
    const body: BatchRequestBody = await request.json()
    const { productGroups, idShippingProvider, idPackaging } = body

    if (!productGroups || productGroups.length === 0) {
      return NextResponse.json(
        { error: 'No product groups provided' },
        { status: 400 }
      )
    }

    // Calculate total orders
    const totalOrders = productGroups.reduce(
      (sum, group) => sum + group.orders.length,
      0
    )

    console.log(`[${batchId}] Processing ${totalOrders} orders across ${productGroups.length} product groups`)

    // ========================================
    // STEP 1: Pre-validate all picklists
    // ========================================
    console.log(`[${batchId}] Step 1: Pre-validating ${totalOrders} picklists...`)

    const validatedPicklists: ValidatedPicklist[] = []
    const validationErrors: string[] = []

    for (const group of productGroups) {
      for (const order of group.orders) {
        try {
          const picklist = await fetchPicklist(order.idPicklist)

          // Check if picklist is in 'new' status
          if (picklist.status !== 'new') {
            validationErrors.push(
              `Order ${order.reference}: Picklist ${order.idPicklist} has status '${picklist.status}' (must be 'new')`
            )
            continue
          }

          // Check if already in a batch
          if (picklist.idpicklist_batch !== null) {
            validationErrors.push(
              `Order ${order.reference}: Picklist ${order.idPicklist} is already in batch ${picklist.idpicklist_batch}`
            )
            continue
          }

          validatedPicklists.push({
            picklistId: order.idPicklist,
            warehouseId: picklist.idwarehouse,
            status: picklist.status,
            order,
            productGroup: group,
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          validationErrors.push(
            `Order ${order.reference}: Failed to fetch picklist ${order.idPicklist}: ${errorMsg}`
          )
        }
      }
    }

    // If any validation errors, fail the entire operation
    if (validationErrors.length > 0) {
      console.error(`[${batchId}] Validation failed with ${validationErrors.length} errors:`, validationErrors)
      return NextResponse.json(
        {
          success: false,
          batchId,
          error: 'Picklist validation failed',
          validationErrors,
        },
        { status: 400 }
      )
    }

    if (validatedPicklists.length === 0) {
      return NextResponse.json(
        { error: 'No valid picklists found after validation' },
        { status: 400 }
      )
    }

    console.log(`[${batchId}] Validation passed: ${validatedPicklists.length} picklists valid`)

    // ========================================
    // STEP 2: Group picklists by warehouse
    // ========================================
    const warehouseGroups = new Map<number, ValidatedPicklist[]>()

    for (const vp of validatedPicklists) {
      const existing = warehouseGroups.get(vp.warehouseId) || []
      existing.push(vp)
      warehouseGroups.set(vp.warehouseId, existing)
    }

    console.log(`[${batchId}] Step 2: Grouped into ${warehouseGroups.size} warehouse(s):`,
      Array.from(warehouseGroups.entries()).map(([wh, pls]) => `WH${wh}: ${pls.length} picklists`).join(', ')
    )

    // Create batch record in Supabase
    await createSingleOrderBatch(batchId, totalOrders)

    // ========================================
    // STEP 3: Create Picqer batches (one per warehouse)
    // ========================================
    const picqerBatchIds: number[] = []

    for (const [warehouseId, warehousePicklists] of warehouseGroups) {
      const picklistIds = warehousePicklists.map(vp => vp.picklistId)

      try {
        console.log(`[${batchId}] Step 3: Creating Picqer batch for warehouse ${warehouseId} with ${picklistIds.length} picklists...`)
        const picqerBatch = await createPicklistBatch(picklistIds)
        picqerBatchIds.push(picqerBatch.idpicklist_batch)
        console.log(`[${batchId}] Picqer batch created: ${picqerBatch.idpicklist_batch} (${picqerBatch.batchid}) for warehouse ${warehouseId}`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[${batchId}] Failed to create Picqer batch for warehouse ${warehouseId}:`, error)

        // Update batch record as failed
        await updateSingleOrderBatch(batchId, { status: 'failed' })

        return NextResponse.json(
          {
            success: false,
            batchId,
            error: `Failed to create Picqer batch for warehouse ${warehouseId}`,
            details: errorMsg,
          },
          { status: 500 }
        )
      }
    }

    // Store first batch ID for backward compatibility (or all if needed)
    const picqerBatchId = picqerBatchIds[0]
    console.log(`[${batchId}] All Picqer batches created successfully: ${picqerBatchIds.join(', ')}`)

    // ========================================
    // STEP 4-6: Process shipments and labels
    // ========================================
    const errors: BatchError[] = []
    const processedLabels: ProcessedLabel[] = []
    let successfulShipments = 0
    let failedShipments = 0

    for (const vp of validatedPicklists) {
      const { order, productGroup } = vp

      try {
        // Create shipment label record
        const labelRecord = await createShipmentLabel({
          batch_id: batchId,
          picklist_id: order.idPicklist,
          order_id: order.id,
          order_reference: order.reference,
          retailer: order.retailerName,
          plant_name: productGroup.productName,
          plant_product_code: productGroup.productCode,
        })

        // Step 4: Create shipment in Picqer
        // Use override shipping provider if provided, otherwise fall back to order's provider
        const shippingProviderId = idShippingProvider ?? order.idShippingProvider ?? undefined
        console.log(`[${batchId}] Creating shipment for order ${order.reference} (picklist ${order.idPicklist}, shipping: ${shippingProviderId}, packaging: ${idPackaging ?? 'none'})...`)
        const shipmentResult = await createShipment(order.idPicklist, shippingProviderId, idPackaging)

        if (!shipmentResult.success || !shipmentResult.shipment) {
          throw new Error(shipmentResult.error || 'Failed to create shipment')
        }

        await updateShipmentLabel(labelRecord.id, {
          shipment_id: shipmentResult.shipment.idshipment,
          tracking_code: shipmentResult.shipment.trackingcode,
          original_label_url: shipmentResult.shipment.labelurl,
          status: 'shipment_created',
        })

        // Step 5: Fetch shipping label using the URL from the shipment response
        const labelUrl = shipmentResult.shipment.labelurl_pdf || shipmentResult.shipment.labelurl
        console.log(`[${batchId}] Fetching label for shipment ${shipmentResult.shipment.idshipment}...`)
        const labelResult = await getShipmentLabel(shipmentResult.shipment.idshipment, labelUrl)

        if (!labelResult.success || !labelResult.labelData) {
          throw new Error(labelResult.error || 'Failed to fetch label')
        }

        await updateShipmentLabel(labelRecord.id, {
          status: 'label_fetched',
        })

        // Step 6: Edit label to add plant name
        // Detect carrier from shipment profile name for optimal positioning
        const carrier = getCarrierFromProviderName(shipmentResult.shipment.profile_name)
        console.log(`[${batchId}] Adding plant name "${productGroup.productName}" to label (carrier: ${carrier})...`)
        const editedLabel = await addPlantNameToLabel(
          labelResult.labelData,
          productGroup.productName,
          { carrier }
        )

        await updateShipmentLabel(labelRecord.id, {
          status: 'label_edited',
        })

        // Add to processed labels for combining
        processedLabels.push({
          success: true,
          pdfBuffer: editedLabel,
          orderId: order.id,
          orderReference: order.reference,
          plantName: productGroup.productName,
          retailer: order.retailerName,
        })

        await updateShipmentLabel(labelRecord.id, {
          status: 'completed',
        })

        successfulShipments++
        console.log(`[${batchId}] Successfully processed order ${order.reference}`)

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[${batchId}] Error processing order ${order.reference}:`, errorMessage)

        errors.push({
          orderId: order.id,
          orderReference: order.reference,
          error: errorMessage,
        })

        failedShipments++

        // Add failed label to tracking
        processedLabels.push({
          success: false,
          orderId: order.id,
          orderReference: order.reference,
          plantName: productGroup.productName,
          retailer: order.retailerName,
          error: errorMessage,
        })
      }
    }

    // ========================================
    // STEP 7: Combine all labels into single PDF
    // ========================================
    let combinedPdfUrl: string | undefined

    if (processedLabels.filter(l => l.success).length > 0) {
      try {
        console.log(`[${batchId}] Step 7: Combining ${successfulShipments} labels into single PDF...`)
        const { combinedPdf, sortOrder } = await sortAndCombineLabels(processedLabels)
        console.log(`[${batchId}] Combined PDF created, sort order:`, sortOrder.slice(0, 5), '...')

        // Step 8: Upload to Supabase storage
        combinedPdfUrl = await uploadPdfToStorage(
          batchId,
          `combined-labels-${batchId}.pdf`,
          combinedPdf
        )
        console.log(`[${batchId}] Combined PDF uploaded: ${combinedPdfUrl}`)
      } catch (error) {
        console.error(`[${batchId}] Error combining PDFs:`, error)
        // Continue without combined PDF - individual labels are still tracked
      }
    }

    // Determine final status
    let status: 'completed' | 'partial' | 'failed'
    if (failedShipments === 0) {
      status = 'completed'
    } else if (successfulShipments > 0) {
      status = 'partial'
    } else {
      status = 'failed'
    }

    // Update batch record
    await updateSingleOrderBatch(batchId, {
      successful_shipments: successfulShipments,
      failed_shipments: failedShipments,
      combined_pdf_path: combinedPdfUrl,
      picqer_batch_id: picqerBatchId,
      status,
    })

    // ========================================
    // STEP 9: Trigger n8n webhook (if configured)
    // ========================================
    let webhookTriggered = false
    const webhookUrl = process.env.N8N_SINGLE_ORDER_WEBHOOK_URL

    if (webhookUrl && successfulShipments > 0) {
      try {
        console.log(`[${batchId}] Step 9: Triggering n8n webhook...`)
        const webhookResponse = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchId,
            picqerBatchIds,
            totalOrders,
            successfulShipments,
            failedShipments,
            combinedPdfUrl,
            productGroups: productGroups.map(g => ({
              productName: g.productName,
              productCode: g.productCode,
              orderCount: g.orders.length,
            })),
            warehouseCount: warehouseGroups.size,
            timestamp: new Date().toISOString(),
          }),
        })

        webhookTriggered = webhookResponse.ok
        console.log(`[${batchId}] Webhook response: ${webhookResponse.status}`)

        await updateSingleOrderBatch(batchId, { webhook_triggered: webhookTriggered })
      } catch (error) {
        console.error(`[${batchId}] Webhook error:`, error)
      }
    }

    console.log(`[${batchId}] Batch creation complete: ${successfulShipments} successful, ${failedShipments} failed`)

    return NextResponse.json({
      success: status !== 'failed',
      batchId,
      picqerBatchId,
      picqerBatchIds,
      totalOrders,
      successfulShipments,
      failedShipments,
      combinedPdfUrl,
      webhookTriggered,
      warehouseCount: warehouseGroups.size,
      errors: errors.length > 0 ? errors : undefined,
      status,
    })

  } catch (error) {
    console.error(`[${batchId}] Fatal error creating batch:`, error)

    // Try to update batch status
    try {
      await updateSingleOrderBatch(batchId, { status: 'failed' })
    } catch {
      // Ignore update error
    }

    return NextResponse.json(
      {
        success: false,
        batchId,
        error: 'Failed to create batch',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
