import { NextRequest, NextResponse } from 'next/server'
import { getPicklists, addPicklistToBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches/[id]/picklists
 * Fetch all picklists belonging to a batch
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    const picklists = await getPicklists({ idpicklist_batch: batchId })

    return NextResponse.json({
      picklists,
      total: picklists.length,
    })
  } catch (error) {
    console.error('[picqer] Error fetching batch picklists:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch picklists', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/picqer/picklist-batches/[id]/picklists
 * Add a picklist to a batch
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    const body = await request.json()
    const picklistId = body.picklistId

    if (!picklistId || typeof picklistId !== 'number') {
      return NextResponse.json({ error: 'picklistId is required and must be a number' }, { status: 400 })
    }

    const result = await addPicklistToBatch(batchId, picklistId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[picqer] Error adding picklist to batch:', error)
    return NextResponse.json(
      { error: 'Failed to add picklist to batch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
