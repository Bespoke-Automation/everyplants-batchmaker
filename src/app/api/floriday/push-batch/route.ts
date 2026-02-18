import { NextRequest, NextResponse } from 'next/server'
import { pushProductBatch } from '@/lib/floriday/push-batch-service'

/**
 * POST /api/floriday/push-batch
 * Body: { picqerProductId, bulkPickStock, poDetails }
 *
 * Maakt een Floriday Batch aan voor één product op basis van de weekstock.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { picqerProductId, bulkPickStock, poDetails } = body

    if (!picqerProductId || typeof picqerProductId !== 'number') {
      return NextResponse.json(
        { success: false, error: 'picqerProductId is vereist (number)' },
        { status: 400 }
      )
    }

    const result = await pushProductBatch(
      picqerProductId,
      bulkPickStock ?? 0,
      poDetails ?? []
    )

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
