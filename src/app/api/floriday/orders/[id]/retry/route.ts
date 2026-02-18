import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getSalesOrder, syncAll } from '@/lib/floriday/client'
import { processSalesOrder, refreshWarehouseCache } from '@/lib/floriday/sync/order-sync'
import type { FloridayFulfillmentOrder } from '@/lib/floriday/types'

/**
 * POST /api/floriday/orders/[id]/retry
 *
 * Herverwerkt één Floriday order: haalt de actuele order + fulfillment op uit Floriday
 * en schiet hem opnieuw in Picqer. Verwijdert de bestaande order_mapping entry zodat
 * de duplicate-check niet triggert.
 *
 * [id] = floriday_sales_order_id (UUID)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: salesOrderId } = await params

  try {
    // 1. Verwijder bestaande mapping zodat processSalesOrder niet skip
    await supabase
      .schema('floriday')
      .from('order_mapping')
      .delete()
      .eq('floriday_sales_order_id', salesOrderId)

    // 2. Haal actuele sales order op uit Floriday
    const salesOrder = await getSalesOrder(salesOrderId)

    // 3. Refresh warehouse cache (voor afleveradres)
    await refreshWarehouseCache()

    // 4. Sync alle fulfillment orders om lookup te bouwen
    const fulfillmentOrders: FloridayFulfillmentOrder[] = []
    await syncAll<FloridayFulfillmentOrder>(
      'fulfillment-orders',
      0,
      async (results) => {
        fulfillmentOrders.push(...results)
      }
    )

    // Build salesOrderId → FulfillmentOrder lookup
    const foBySOId = new Map<string, FloridayFulfillmentOrder>()
    for (const fo of fulfillmentOrders) {
      for (const lc of fo.loadCarriers || []) {
        for (const item of lc.loadCarrierItems || []) {
          if (item.salesOrderId && !foBySOId.has(item.salesOrderId)) {
            foBySOId.set(item.salesOrderId, fo)
          }
        }
      }
    }

    // 5. Verwerk de order
    const result = await processSalesOrder(salesOrder, foBySOId)

    // 6. Haal bijgewerkte mapping op voor response
    const { data: mapping } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('picqer_order_number, processing_status, error_message, reference')
      .eq('floriday_sales_order_id', salesOrderId)
      .single()

    return NextResponse.json({
      success: result !== 'failed',
      result,
      picqer_order_number: mapping?.picqer_order_number || null,
      reference: mapping?.reference || null,
      error: mapping?.error_message || null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Retry failed for order ${salesOrderId}:`, message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
