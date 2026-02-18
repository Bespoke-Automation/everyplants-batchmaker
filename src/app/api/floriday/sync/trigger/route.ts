import { NextRequest, NextResponse } from 'next/server'
import { syncOrders } from '@/lib/floriday/sync/order-sync'
import { refreshWarehouseCache } from '@/lib/floriday/sync/order-sync'

/**
 * POST /api/floriday/sync/trigger
 *
 * Handmatige sync trigger vanuit het dashboard.
 * Body: { action: 'full-sync' | 'warehouse-cache' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action = body.action || 'full-sync'

    if (action === 'warehouse-cache') {
      const count = await refreshWarehouseCache()
      return NextResponse.json({
        success: true,
        message: `Warehouse cache bijgewerkt: ${count} locaties`,
      })
    }

    // Default: full sync
    const result = await syncOrders()

    return NextResponse.json({
      success: result.success,
      message: `Sync voltooid: ${result.ordersCreated} aangemaakt, ${result.ordersSkipped} overgeslagen, ${result.ordersFailed} mislukt`,
      data: result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Sync trigger error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
