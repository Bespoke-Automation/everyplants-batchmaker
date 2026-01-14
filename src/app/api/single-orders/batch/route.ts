import { NextResponse } from 'next/server'
import { createPicklistBatch } from '@/lib/picqer/client'
import {
  createShipmentLabel,
  createSingleOrderBatch,
  updateSingleOrderBatch,
} from '@/lib/supabase/shipmentLabels'
import { inngest } from '@/inngest/client'

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
 * Creates Picqer batch and queues shipments for processing via Inngest.
 *
 * Flow:
 * 1. Collect all picklist IDs from request (trust frontend data)
 * 2. Create Picqer batch with all picklists (single API call)
 * 3. Create shipment_labels records with status 'queued'
 * 4. Trigger Inngest function for durable background processing
 * 5. Return immediately with batchId
 *
 * Inngest then:
 * - Creates shipments in Picqer (with retries)
 * - Fetches and edits labels
 * - Combines labels into single PDF
 * - Triggers webhook
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

    // Flatten all orders from product groups
    const allOrders: Array<{ order: OrderInGroup; productGroup: ProductGroupInput }> = []
    for (const group of productGroups) {
      for (const order of group.orders) {
        allOrders.push({ order, productGroup: group })
      }
    }

    const totalOrders = allOrders.length
    console.log(`[${batchId}] Processing ${totalOrders} orders across ${productGroups.length} product groups`)

    // Create batch record in Supabase
    await createSingleOrderBatch(batchId, totalOrders)

    // ========================================
    // Create Picqer batch with all picklist IDs (single API call)
    // Trust frontend data - if any picklist is invalid, Picqer will reject
    // ========================================
    const picklistIds = allOrders.map(o => o.order.idPicklist)
    let picqerBatchIds: number[] = []
    let picqerBatchNumber: string | null = null

    try {
      console.log(`[${batchId}] Creating Picqer batch with ${picklistIds.length} picklists...`)
      const picqerBatch = await createPicklistBatch(picklistIds)
      picqerBatchIds = [picqerBatch.idpicklist_batch]
      picqerBatchNumber = picqerBatch.batchid || null
      console.log(`[${batchId}] Picqer batch created: ${picqerBatch.idpicklist_batch} (${picqerBatch.batchid})`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[${batchId}] Failed to create Picqer batch:`, error)

      await updateSingleOrderBatch(batchId, { status: 'failed' })

      return NextResponse.json(
        {
          success: false,
          batchId,
          error: 'Failed to create Picqer batch',
          details: errorMsg,
        },
        { status: 500 }
      )
    }

    // ========================================
    // Create shipment_labels records with 'queued' status
    // ========================================
    console.log(`[${batchId}] Creating ${totalOrders} shipment label records...`)

    for (const { order, productGroup } of allOrders) {
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
      picqer_batch_number: picqerBatchNumber,
      shipping_provider_id: idShippingProvider ?? null,
      packaging_id: idPackaging ?? null,
      status: 'processing_shipments',
    })

    console.log(`[${batchId}] Batch record updated, all shipment labels queued`)

    // ========================================
    // Trigger Inngest function for durable background processing
    // ========================================
    await inngest.send({
      name: 'batch/process.requested',
      data: { batchId },
    })

    console.log(`[${batchId}] Inngest function triggered, returning immediately`)

    return NextResponse.json({
      success: true,
      batchId,
      picqerBatchId: picqerBatchIds[0],
      picqerBatchIds,
      totalOrders,
      status: 'processing_shipments',
      message: 'Batch created. Shipments are being processed in the background.',
    })

  } catch (error) {
    console.error(`[${batchId}] Fatal error creating batch:`, error)

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
