import { NextRequest, NextResponse } from 'next/server'
import { removePicklistFromBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/picqer/picklist-batches/[id]/picklists/[picklistId]
 * Remove a picklist from a batch
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; picklistId: string }> }
) {
  try {
    const { id, picklistId } = await params
    const batchId = parseInt(id, 10)
    const plId = parseInt(picklistId, 10)

    if (isNaN(batchId) || isNaN(plId)) {
      return NextResponse.json({ error: 'Invalid batch ID or picklist ID' }, { status: 400 })
    }

    await removePicklistFromBatch(batchId, plId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[picqer] Error removing picklist from batch:', error)
    return NextResponse.json(
      { error: 'Failed to remove picklist from batch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
