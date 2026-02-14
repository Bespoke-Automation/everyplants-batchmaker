import { NextRequest, NextResponse } from 'next/server'
import { getShipment, cancelShipment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/shipments/[id]
 * Get a single shipment by ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const shipmentId = parseInt(id, 10)

  if (isNaN(shipmentId)) {
    return NextResponse.json({ error: 'Invalid shipment ID' }, { status: 400 })
  }

  try {
    const shipment = await getShipment(shipmentId)
    return NextResponse.json({ shipment })
  } catch (error) {
    console.error('[picqer] Error fetching shipment:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/picqer/shipments/[id]
 * Cancel a shipment (only within 5 minutes of creation)
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const shipmentId = parseInt(id, 10)

  if (isNaN(shipmentId)) {
    return NextResponse.json({ error: 'Invalid shipment ID' }, { status: 400 })
  }

  try {
    const result = await cancelShipment(shipmentId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to cancel shipment' },
        { status: 422 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[picqer] Error cancelling shipment:', error)
    return NextResponse.json(
      { error: 'Failed to cancel shipment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
