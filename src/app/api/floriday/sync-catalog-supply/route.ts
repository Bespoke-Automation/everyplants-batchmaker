import { NextResponse } from 'next/server'
import { syncAllKunstplantStock, syncSelectedProductsBulk } from '@/lib/floriday/catalog-supply-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/sync-catalog-supply
 *
 * Sync de catalog supply (numberOfPieces) naar Floriday via bulk PUT.
 *
 * Body:
 *   - picqerProductId (optional): sync 1 product via bulk PUT
 *
 * Zonder picqerProductId: sync alle producten met tag "kunstplant".
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { picqerProductId } = body as {
      picqerProductId?: number
    }

    if (picqerProductId) {
      const result = await syncSelectedProductsBulk([picqerProductId])
      return NextResponse.json(result, {
        status: result.success ? 200 : 422,
      })
    }

    const result = await syncAllKunstplantStock()
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Catalog supply sync error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
