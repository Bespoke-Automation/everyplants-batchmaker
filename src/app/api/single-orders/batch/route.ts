import { NextResponse } from 'next/server'
import { createPicklistBatch, fetchPicklist } from '@/lib/picqer/client'
import {
  createShipmentLabel,
  createSingleOrderBatch,
  updateSingleOrderBatch,
} from '@/lib/supabase/shipmentLabels'

export const dynamic = 'force-dynamic'

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
 * Trigger internal API route to process shipments asynchronously
 * Fire and forget - logs errors but doesn't block
 */
function triggerShipmentProcessing(batchId: string): void {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const processUrl = `${baseUrl}/api/single-orders/batch/${batchId}/process`

  // Fire and forget - log errors but don't block
  fetch(processUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => {
      if (!response.ok) {
        console.error(`[${batchId}] Process endpoint returned ${response.status}`)
      }
    })
    .catch(error => {
      console.error(`[${batchId}] Failed to trigger processing:`, error)
    })

  console.log(`[${batchId}] Triggered async shipment processing`)
}

/**
 * POST /api/single-orders/batch
 *
 * Creates Picqer batch and queues shipments for async processing.
 *
 * Flow (v3 - Async):
 * 1. Pre-validate all picklists (fetch status and warehouse)
 * 2. Group picklists by warehouse
 * 3. Create Picqer batch for each warehouse group (fail all if any fails)
 * 4. Create shipment_labels records with status 'queued'
 * 5. Trigger Edge Function for async shipment processing
 * 6. Return immediately with batchId
 *
 * The Edge Function then:
 * - Creates shipments in Picqer
 * - Fetches and edits labels
 * - Combines labels into single PDF
 * - Triggers webhook
 */
export async function POST(request: Request) {
  const batchId = generateBatchId()
  console.log(`[${batchId}] Starting single order batch creation (async mode)...`)

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

    // Create batch record in Supabase with processing_shipments status
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

    console.log(`[${batchId}] All Picqer batches created successfully: ${picqerBatchIds.join(', ')}`)

    // ========================================
    // STEP 4: Create shipment_labels records with 'queued' status
    // ========================================
    console.log(`[${batchId}] Step 4: Creating ${validatedPicklists.length} shipment label records...`)

    for (const vp of validatedPicklists) {
      const { order, productGroup } = vp

      await createShipmentLabel({
        batch_id: batchId,
        picklist_id: order.idPicklist,
        order_id: order.id,
        order_reference: order.reference,
        retailer: order.retailerName,
        plant_name: productGroup.productName,
        plant_product_code: productGroup.productCode,
      })
    }

    // Update batch record with Picqer batch IDs and shipping config
    await updateSingleOrderBatch(batchId, {
      picqer_batch_id: picqerBatchIds[0],
      picqer_batch_ids: picqerBatchIds,
      shipping_provider_id: idShippingProvider ?? null,
      packaging_id: idPackaging ?? null,
      status: 'processing_shipments',
    })

    console.log(`[${batchId}] Batch record updated, all shipment labels queued`)

    // ========================================
    // STEP 5: Trigger processing (fire and forget)
    // ========================================
    triggerShipmentProcessing(batchId)

    console.log(`[${batchId}] Batch creation complete, returning immediately while shipments process in background`)

    // Return immediately - shipments will be processed asynchronously
    return NextResponse.json({
      success: true,
      batchId,
      picqerBatchId: picqerBatchIds[0],
      picqerBatchIds,
      totalOrders,
      warehouseCount: warehouseGroups.size,
      status: 'processing_shipments',
      message: 'Batch created. Shipments are being processed in the background.',
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
