import { NextRequest, NextResponse } from 'next/server'
import { getProductPicklistsInBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches/[id]/products/[productId]/picklists
 * Get picklists for a specific product within a batch
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; productId: string }> }
) {
  try {
    const { id, productId } = await params
    const batchId = parseInt(id, 10)
    const prodId = parseInt(productId, 10)

    if (isNaN(batchId) || isNaN(prodId)) {
      return NextResponse.json({ error: 'Invalid batch ID or product ID' }, { status: 400 })
    }

    const picklists = await getProductPicklistsInBatch(batchId, prodId)

    return NextResponse.json({ picklists })
  } catch (error) {
    console.error('[picqer] Error fetching product picklists in batch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch product picklists', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
