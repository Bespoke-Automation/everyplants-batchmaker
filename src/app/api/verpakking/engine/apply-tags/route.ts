import { NextResponse } from 'next/server'
import { applyTags } from '@/lib/engine/packagingEngine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/engine/apply-tags
 * Applies packaging tags to an order in Picqer based on a calculated advice.
 *
 * Body: {
 *   orderId: number,
 *   adviceId: string
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { orderId, adviceId } = body

    // Validate required fields
    if (!orderId || typeof orderId !== 'number') {
      return NextResponse.json(
        { error: 'orderId is required and must be a number' },
        { status: 400 }
      )
    }

    if (!adviceId || typeof adviceId !== 'string') {
      return NextResponse.json(
        { error: 'adviceId is required and must be a string (uuid)' },
        { status: 400 }
      )
    }

    console.log(`[engine/apply-tags] Applying tags for order ${orderId}, advice ${adviceId}`)

    const tagsWritten = await applyTags(orderId, adviceId)

    return NextResponse.json({ success: true, tagsWritten })
  } catch (error) {
    console.error('[engine/apply-tags] Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to apply packaging tags',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
