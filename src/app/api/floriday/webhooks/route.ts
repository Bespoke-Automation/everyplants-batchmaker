import { NextRequest, NextResponse } from 'next/server'
import { getSalesOrder, syncFulfillmentOrders } from '@/lib/floriday/client'
import { processSalesOrder } from '@/lib/floriday/sync/order-sync'
import { refreshWarehouseCache } from '@/lib/floriday/sync/order-sync'
import type { FloridayFulfillmentOrder } from '@/lib/floriday/types'

/**
 * POST /api/floriday/webhooks
 *
 * Floriday webhook ontvanger voor sales order events.
 * Floriday stuurt een event met salesOrderId → we fetchen de order en verwerken hem.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('Floriday webhook received:', JSON.stringify(body).slice(0, 500))

    // Floriday webhook payload bevat een aggregateId (= salesOrderId)
    const salesOrderId = body.aggregateId || body.salesOrderId
    if (!salesOrderId) {
      return NextResponse.json(
        { error: 'Missing aggregateId/salesOrderId' },
        { status: 400 }
      )
    }

    // Refresh warehouse cache
    await refreshWarehouseCache()

    // Fetch the full sales order
    const salesOrder = await getSalesOrder(salesOrderId)

    // Fetch fulfillment orders (sync all recent ones)
    const fulfillmentOrders: FloridayFulfillmentOrder[] = []
    const foResponse = await syncFulfillmentOrders(0) // TODO: track FO sequence in webhook context
    if (foResponse.results) {
      fulfillmentOrders.push(...foResponse.results)
    }

    // Build lookup
    const foLookup = new Map<string, FloridayFulfillmentOrder>()
    for (const fo of fulfillmentOrders) {
      for (const lc of fo.loadCarriers || []) {
        for (const item of lc.loadCarrierItems || []) {
          if (item.salesOrderId && !foLookup.has(item.salesOrderId)) {
            foLookup.set(item.salesOrderId, fo)
          }
        }
      }
    }

    // Process the order
    const result = await processSalesOrder(salesOrder, foLookup)

    return NextResponse.json({
      success: true,
      result,
      salesOrderId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Webhook processing error:', message)

    // Return 200 to prevent Floriday from retrying
    // (we log the error in order_mapping)
    return NextResponse.json({
      success: false,
      error: message,
    })
  }
}
