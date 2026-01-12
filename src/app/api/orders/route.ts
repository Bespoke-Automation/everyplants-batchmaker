import { NextResponse } from 'next/server'
import { fetchAllOrders } from '@/lib/picqer/client'
import { filterEligibleOrders, transformOrder, extractMetadata } from '@/lib/picqer/transform'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Fetch all processing orders with pagination
    const allOrders = await fetchAllOrders()
    console.log(`Fetched ${allOrders.length} total orders from Picqer`)

    // Debug: Log first order to see delivery fields
    if (allOrders.length > 0) {
      const sample = allOrders[0]
      console.log('Sample order delivery fields:', {
        deliverycountry: sample.deliverycountry,
        deliveryzipcode: sample.deliveryzipcode,
      })
    }

    // Filter eligible orders (server-side pre-filtering)
    const eligibleOrders = filterEligibleOrders(allOrders)
    console.log(`${eligibleOrders.length} orders are eligible for batching`)

    // Transform to app format
    const transformedOrders = eligibleOrders.map(transformOrder)

    // Extract unique values for filter dropdowns
    const metadata = extractMetadata(transformedOrders)

    return NextResponse.json({
      orders: transformedOrders,
      metadata,
      total: transformedOrders.length,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
