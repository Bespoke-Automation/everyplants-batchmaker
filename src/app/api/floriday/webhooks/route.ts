import { NextRequest, NextResponse } from 'next/server'
import { getFulfillmentOrder } from '@/lib/floriday/client'
import { processFulfillmentOrder, handleCorrectedFO, handleCancelledFO, refreshWarehouseCache, isOrderSyncDisabled } from '@/lib/floriday/sync/order-sync'

/**
 * POST /api/floriday/webhooks
 *
 * Floriday webhook ontvanger.
 * Handles:
 * - Subscription confirmation (subscribeURL in body → GET to confirm)
 * - FULFILLMENTORDER events (fetch FO → process into Picqer)
 * - SALESORDER events (ignored — we process at FO level)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('Floriday webhook received:', JSON.stringify(body).slice(0, 500))

    // Handle subscription confirmation
    if (body.subscribeURL) {
      console.log('Webhook subscription confirmation, fetching:', body.subscribeURL)
      const confirmResponse = await fetch(body.subscribeURL)
      console.log('Subscription confirmed:', confirmResponse.status)
      return NextResponse.json({ success: true, action: 'subscription_confirmed' })
    }

    // Handle events
    const aggregateType = body.aggregateType
    const aggregateId = body.aggregateId
    const eventType = body.eventType

    if (!aggregateId) {
      return NextResponse.json({ error: 'Missing aggregateId' }, { status: 400 })
    }

    // Only process FULFILLMENTORDER events
    if (aggregateType === 'FULFILLMENTORDER') {
      if (isOrderSyncDisabled()) {
        console.log(`Webhook FO event ${eventType} genegeerd — order sync is uitgeschakeld`)
        return NextResponse.json({ success: true, action: 'ignored', reason: 'order sync disabled' })
      }
      const fo = await getFulfillmentOrder(aggregateId)

      if (eventType === 'ACCEPTED' || eventType === 'SUBMITTED') {
        await refreshWarehouseCache()
        const result = await processFulfillmentOrder(fo)
        return NextResponse.json({ success: true, result, fulfillmentOrderId: aggregateId })
      }

      if (eventType === 'CORRECTED') {
        await refreshWarehouseCache()
        const result = await handleCorrectedFO(fo)
        return NextResponse.json({ success: true, result, fulfillmentOrderId: aggregateId })
      }

      if (eventType === 'CANCELLED') {
        const result = await handleCancelledFO(fo)
        return NextResponse.json({ success: true, result, fulfillmentOrderId: aggregateId })
      }

      // REJECTED en overige events: log maar verwerk niet
      console.log(`Ignoring FO event: ${eventType} for ${aggregateId}`)
      return NextResponse.json({ success: true, action: 'ignored', reason: `eventType ${eventType}` })
    }

    // Ignore other aggregate types (SALESORDER, BATCH, DELIVERYORDER)
    console.log(`Ignoring webhook: ${aggregateType}/${eventType} for ${aggregateId}`)
    return NextResponse.json({ success: true, action: 'ignored', reason: `aggregateType ${aggregateType}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Webhook processing error:', message)

    // Return 200 to prevent Floriday from retrying
    return NextResponse.json({ success: false, error: message })
  }
}
