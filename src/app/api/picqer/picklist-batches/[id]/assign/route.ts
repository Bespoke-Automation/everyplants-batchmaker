import { NextRequest, NextResponse } from 'next/server'
import { assignPicklistBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picqer/picklist-batches/[id]/assign
 * Assign a picklist batch to a user
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

    const { userId } = await request.json()

    if (userId !== null && (typeof userId !== 'number' || !Number.isInteger(userId))) {
      return NextResponse.json({ error: 'userId must be a number or null' }, { status: 400 })
    }

    const result = await assignPicklistBatch(batchId, userId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[picqer] Error assigning picklist batch:', error)
    return NextResponse.json(
      { error: 'Failed to assign batch', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
