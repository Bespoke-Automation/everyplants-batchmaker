import { NextRequest, NextResponse } from 'next/server'
import { addComment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picqer/orders/[id]/comments
 * Add a comment to an order
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const orderId = parseInt(id, 10)

    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 })
    }

    const { body } = await request.json()

    if (!body || typeof body !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid body' }, { status: 400 })
    }

    const comment = await addComment('orders', orderId, body)
    return NextResponse.json({ comment })
  } catch (error) {
    console.error('[picqer] Error adding order comment:', error)
    return NextResponse.json(
      { error: 'Failed to add comment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
