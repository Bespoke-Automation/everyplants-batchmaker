import { NextRequest, NextResponse } from 'next/server'
import { fetchPicklist, getPicklistBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const picklist = await fetchPicklist(Number(id))

    // Enrich products with images from the batch (picklist products don't include images)
    if (picklist.idpicklist_batch && picklist.products?.length > 0) {
      try {
        const batch = await getPicklistBatch(picklist.idpicklist_batch)
        const imageMap = new Map<number, string>()
        for (const bp of batch.products ?? []) {
          if (bp.image) {
            imageMap.set(bp.idproduct, bp.image)
          }
        }
        for (const product of picklist.products) {
          const image = imageMap.get(product.idproduct)
          if (image) {
            product.image = image
          }
        }
      } catch {
        // Non-critical: continue without images
      }
    }

    return NextResponse.json({
      picklist,
    })
  } catch (error) {
    console.error('[picqer] Error fetching picklist:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
