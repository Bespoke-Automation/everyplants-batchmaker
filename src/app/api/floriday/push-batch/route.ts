import { NextRequest, NextResponse } from 'next/server'
import { pushProductBatchLive } from '@/lib/floriday/push-batch-service'

/**
 * POST /api/floriday/push-batch
 * Body: { picqerProductId: number }
 *
 * Haalt live stock op uit Picqer voor één product en maakt Floriday batch(es) aan.
 * Werkt onafhankelijk van de stock cache.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { picqerProductId } = body

    if (!picqerProductId || typeof picqerProductId !== 'number') {
      return NextResponse.json(
        { success: false, error: 'picqerProductId is vereist (number)' },
        { status: 400 }
      )
    }

    const result = await pushProductBatchLive(picqerProductId)

    if (!result.success) {
      return NextResponse.json(result, { status: 422 })
    }

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Push batch error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
