import { NextRequest, NextResponse } from 'next/server'
import { fetchOrder } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/orders/[id]
 * Fetch a single order from Picqer
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const orderId = parseInt(id, 10)

    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 })
    }

    const order = await fetchOrder(orderId)

    return NextResponse.json({ order })
  } catch (error) {
    console.error('[picqer] Error fetching order:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
