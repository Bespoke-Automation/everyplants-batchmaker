import { NextResponse } from 'next/server'
import { getActiveShippingUnitsWithCounts } from '@/lib/supabase/shippingUnits'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/shipping-units
 * Returns all active shipping units with product counts ordered by product_type, sort_order
 */
export async function GET() {
  try {
    const shippingUnits = await getActiveShippingUnitsWithCounts()

    return NextResponse.json({
      shippingUnits,
      total: shippingUnits.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching shipping units:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping units', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
