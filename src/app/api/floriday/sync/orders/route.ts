import { NextResponse } from 'next/server'
import { syncOrders } from '@/lib/floriday/sync/order-sync'

/**
 * POST /api/floriday/sync/orders
 *
 * Handmatige trigger om Floriday sales orders te synchen naar Picqer.
 * Kan ook als cron job worden aangeroepen.
 */
export async function POST() {
  try {
    console.log('Starting Floriday order sync...')
    const result = await syncOrders()

    return NextResponse.json({
      success: result.success,
      message: `Sync voltooid: ${result.ordersCreated} aangemaakt, ${result.ordersSkipped} overgeslagen, ${result.ordersFailed} mislukt`,
      data: result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Order sync error:', message)

    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    )
  }
}
