import { NextResponse } from 'next/server'
import { syncSelectedProductsBulk } from '@/lib/floriday/catalog-supply-service'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/catalog-supply/sync
 *
 * Sync catalog supply voor geselecteerde producten via bulk PUT.
 * Gebruikt door de CatalogSupplyPanel UI.
 *
 * Body: { picqerProductIds: number[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { picqerProductIds } = body as { picqerProductIds?: number[] }

    if (!picqerProductIds || !Array.isArray(picqerProductIds) || picqerProductIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'picqerProductIds is verplicht (array van nummers)' },
        { status: 400 }
      )
    }

    const result = await syncSelectedProductsBulk(picqerProductIds)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Catalog supply sync error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
