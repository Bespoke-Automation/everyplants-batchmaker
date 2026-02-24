import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getFulfillmentOrder, syncAll } from '@/lib/floriday/client'
import { processFulfillmentOrder, refreshWarehouseCache } from '@/lib/floriday/sync/order-sync'
import type { FloridayFulfillmentOrder } from '@/lib/floriday/types'

/**
 * POST /api/floriday/orders/[id]/retry
 *
 * Herverwerkt één Floriday fulfillment order: haalt de actuele FO op uit Floriday
 * en schiet hem opnieuw in Picqer. Verwijdert de bestaande order_mapping entry zodat
 * de duplicate-check niet triggert.
 *
 * [id] = floriday_fulfillment_order_id (UUID)
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: fulfillmentOrderId } = await params

  try {
    // 1. Verwijder bestaande mapping zodat processFulfillmentOrder niet skip
    const env = getFloridayEnv()
    await supabase
      .schema('floriday')
      .from('order_mapping')
      .delete()
      .eq('floriday_fulfillment_order_id', fulfillmentOrderId)
      .eq('environment', env)

    // 2. Refresh warehouse cache (voor afleveradres)
    await refreshWarehouseCache()

    // 3. Haal actuele fulfillment order op
    const fo = await getFulfillmentOrder(fulfillmentOrderId)

    // 4. Verwerk het fulfillment order
    const result = await processFulfillmentOrder(fo)

    // 5. Haal bijgewerkte mapping op voor response
    const { data: mapping } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('picqer_order_number, processing_status, error_message, reference')
      .eq('floriday_fulfillment_order_id', fulfillmentOrderId)
      .eq('environment', env)
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
    console.error(`Retry failed for FO ${fulfillmentOrderId}:`, message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
