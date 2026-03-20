import { NextRequest, NextResponse } from 'next/server'
import {
  getBoxCapacities,
  upsertBoxCapacity,
  deleteBoxCapacity,
} from '@/lib/supabase/boxCapacities'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/box-capacities
 * Returns all active box capacities with packaging and shipping unit names
 */
export async function GET() {
  try {
    const capacities = await getBoxCapacities()

    return NextResponse.json({
      capacities,
      total: capacities.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching box capacities:', error)
    return NextResponse.json(
      { error: 'Failed to fetch box capacities', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/box-capacities
 * Upsert a box capacity { packagingId, shippingUnitId, maxQuantity }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { packagingId, shippingUnitId, maxQuantity } = body

    if (!packagingId || !shippingUnitId || maxQuantity === undefined) {
      return NextResponse.json(
        { error: 'Verplichte velden: packagingId, shippingUnitId, maxQuantity' },
        { status: 400 }
      )
    }

    if (typeof maxQuantity !== 'number' || maxQuantity < 1) {
      return NextResponse.json(
        { error: 'maxQuantity moet een positief getal zijn' },
        { status: 400 }
      )
    }

    const capacity = await upsertBoxCapacity(packagingId, shippingUnitId, maxQuantity)

    return NextResponse.json({ capacity })
  } catch (error) {
    console.error('[verpakking] Error upserting box capacity:', error)
    return NextResponse.json(
      { error: 'Failed to upsert box capacity', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/box-capacities
 * Soft-delete a box capacity { id }
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Verplicht veld: id' },
        { status: 400 }
      )
    }

    await deleteBoxCapacity(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error deleting box capacity:', error)
    return NextResponse.json(
      { error: 'Failed to delete box capacity', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
