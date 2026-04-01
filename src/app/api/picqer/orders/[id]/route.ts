import { NextRequest, NextResponse } from 'next/server'
import { fetchOrder, updateOrderAddress } from '@/lib/picqer/client'

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

/**
 * PUT /api/picqer/orders/[id]
 * Update delivery address on an order
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const orderId = parseInt(id, 10)

    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 })
    }

    const body = await request.json()
    const allowedFields = ['deliveryname', 'deliverycontactname', 'deliveryaddress', 'deliveryzipcode', 'deliverycity', 'deliverycountry']
    const address: Record<string, string> = {}
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        address[field] = body[field]
      }
    }

    if (Object.keys(address).length === 0) {
      return NextResponse.json({ error: 'No address fields provided' }, { status: 400 })
    }

    const order = await updateOrderAddress(orderId, address)

    return NextResponse.json({ order })
  } catch (error) {
    console.error('[picqer] Error updating order address:', error)
    return NextResponse.json(
      { error: 'Failed to update order address', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
