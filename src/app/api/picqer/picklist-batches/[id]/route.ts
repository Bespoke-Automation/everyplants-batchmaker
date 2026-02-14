import { NextRequest, NextResponse } from 'next/server'
import { getPicklistBatch, deletePicklistBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches/[id]
 * Fetch a single picklist batch from Picqer
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

    const batch = await getPicklistBatch(batchId)

    return NextResponse.json(batch)
  } catch (error) {
    console.error('[picqer] Error fetching picklist batch:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklist batch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/picqer/picklist-batches/[id]
 * Delete a picklist batch in Picqer
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    await deletePicklistBatch(batchId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[picqer] Error deleting picklist batch:', error)
    return NextResponse.json(
      { error: 'Failed to delete batch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
