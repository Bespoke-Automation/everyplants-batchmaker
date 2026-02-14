import { NextRequest, NextResponse } from 'next/server'
import { createMulticolloShipment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picqer/picklists/[id]/shipments/multicollo
 * Create a multicollo shipment (multiple parcels in one shipment)
 *
 * Body: {
 *   shippingProviderId: number,
 *   parcels: Array<{ idpackaging: number, weight: number }>
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const picklistId = parseInt(id, 10)

  if (isNaN(picklistId)) {
    return NextResponse.json({ error: 'Invalid picklist ID' }, { status: 400 })
  }

  try {
    const body = await request.json()
    const { shippingProviderId, parcels } = body

    if (!shippingProviderId) {
      return NextResponse.json({ error: 'Missing required field: shippingProviderId' }, { status: 400 })
    }

    if (!parcels || !Array.isArray(parcels) || parcels.length < 2) {
      return NextResponse.json({ error: 'Multicollo requires at least 2 parcels' }, { status: 400 })
    }

    // Validate each parcel has required fields
    for (const parcel of parcels) {
      if (!parcel.idpackaging || !parcel.weight) {
        return NextResponse.json(
          { error: 'Each parcel requires idpackaging and weight' },
          { status: 400 }
        )
      }
    }

    const result = await createMulticolloShipment(picklistId, shippingProviderId, parcels)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create multicollo shipment' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      shipment: result.shipment,
    })
  } catch (error) {
    console.error('[picqer] Error creating multicollo shipment:', error)
    return NextResponse.json(
      { error: 'Failed to create multicollo shipment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
