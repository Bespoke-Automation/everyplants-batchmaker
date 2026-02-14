import { NextRequest, NextResponse } from 'next/server'
import { getPicklistShipments } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklists/[id]/shipments
 * Get all shipments for a picklist
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const picklistId = parseInt(id, 10)

  if (isNaN(picklistId)) {
    return NextResponse.json({ error: 'Invalid picklist ID' }, { status: 400 })
  }

  try {
    const shipments = await getPicklistShipments(picklistId)
    return NextResponse.json({ shipments, total: shipments.length })
  } catch (error) {
    console.error('[picqer] Error fetching picklist shipments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
