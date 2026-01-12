import { NextResponse } from 'next/server'
import { fetchAllOrders } from '@/lib/picqer/client'
import { filterEligibleOrders, transformOrder, extractMetadata } from '@/lib/picqer/transform'
import { analyzeSingleOrder } from '@/lib/picqer/singleOrders'
import { groupSingleOrdersByProduct } from '@/lib/singleOrders/grouping'
import { SingleOrderWithProduct } from '@/types/singleOrder'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    console.log('Fetching single orders...')

    // 1. Fetch all processing orders (uses cache if available)
    const allOrders = await fetchAllOrders()
    console.log(`Fetched ${allOrders.length} total orders from Picqer`)

    // 2. Filter eligible orders
    const eligibleOrders = filterEligibleOrders(allOrders)
    console.log(`${eligibleOrders.length} orders are eligible`)

    // 3. Analyze each order using products directly from order data
    // No additional API calls needed!
    const singleOrders: SingleOrderWithProduct[] = []

    for (const order of eligibleOrders) {
      if (!order.products || order.products.length === 0) {
        continue
      }

      // Analyze if single order based on productcodes
      const analysis = analyzeSingleOrder(order.products)

      if (analysis.isSingleOrder && analysis.plantProduct) {
        const transformed = transformOrder(order)
        singleOrders.push({
          ...transformed,
          plantProduct: analysis.plantProduct,
        })
      }
    }

    console.log(`Found ${singleOrders.length} single orders`)

    // 6. Group by product (minimum 5 orders per group)
    const productGroups = groupSingleOrdersByProduct(singleOrders, 5)
    console.log(`Created ${productGroups.length} product groups with 5+ orders`)

    // 7. Extract metadata for filters
    const metadata = extractMetadata(singleOrders)

    return NextResponse.json({
      groups: productGroups,
      totalSingleOrders: singleOrders.length,
      metadata,
      fetchedAt: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Error fetching single orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch single orders', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
