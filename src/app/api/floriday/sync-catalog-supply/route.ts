import { NextResponse } from 'next/server'
import { syncProductCatalogSupply, syncAllKunstplantStock } from '@/lib/floriday/catalog-supply-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/sync-catalog-supply
 *
 * Sync de catalog supply (numberOfPieces) naar Floriday via het base-supply PATCH endpoint.
 *
 * Body:
 *   - picqerProductId (optional): sync 1 product (test modus)
 *   - dryRun (optional): bereken alleen, push niet naar Floriday
 *
 * Zonder picqerProductId: sync alle producten met tag "kunstplant".
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { picqerProductId, dryRun } = body as {
      picqerProductId?: number
      dryRun?: boolean
    }

    if (picqerProductId) {
      // Single product sync
      const result = await syncProductCatalogSupply(picqerProductId, { dryRun })
      return NextResponse.json(result, {
        status: result.success ? 200 : 422,
      })
    }

    // Bulk sync: alle kunstplant-producten
    const result = await syncAllKunstplantStock({ dryRun })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Catalog supply sync error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
