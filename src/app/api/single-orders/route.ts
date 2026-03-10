import { NextResponse } from 'next/server'
import { fetchAllOrders } from '@/lib/picqer/client'
import { filterEligibleOrders, transformOrder, extractMetadata } from '@/lib/picqer/transform'
import { analyzeOrderCombination } from '@/lib/picqer/singleOrders'
import { groupOrdersByCombination } from '@/lib/singleOrders/grouping'
import { SingleOrderWithProduct } from '@/types/singleOrder'
import { getExcludedProductCodes } from '@/lib/supabase/excludedProducts'
import { getTagsByType } from '@/lib/supabase/localTags'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    console.log('Fetching single orders...')

    // 1. Fetch excluded product codes and packaging tag titles in parallel
    const [excludedProductCodes, packagingTags] = await Promise.all([
      getExcludedProductCodes(),
      getTagsByType('packaging'),
    ])
    const packagingTagIds = new Set(packagingTags.map(t => t.idtag))
    console.log(`Loaded ${excludedProductCodes.size} excluded products, ${packagingTagIds.size} packaging tags`)

    // 2. Fetch all processing orders (uses cache if available)
    const allOrders = await fetchAllOrders()
    console.log(`Fetched ${allOrders.length} total orders from Picqer`)

    // 3. Filter eligible orders
    const eligibleOrders = filterEligibleOrders(allOrders)
    console.log(`${eligibleOrders.length} orders are eligible`)

    // 4. Analyze each order: build combination fingerprint, filter multi-packaging-tag orders
    const matchedOrders: SingleOrderWithProduct[] = []

    for (const order of eligibleOrders) {
      if (!order.products || order.products.length === 0) {
        continue
      }

      const transformed = transformOrder(order)

      // Skip orders with more than 1 packaging tag (need manual handling)
      const packagingTagCount = transformed.tagIds.filter(id => packagingTagIds.has(id)).length
      if (packagingTagCount > 1) {
        continue
      }

      // Analyze product combination
      const analysis = analyzeOrderCombination(order.products, excludedProductCodes)
      if (!analysis) continue

      matchedOrders.push({
        ...transformed,
        combinationProducts: analysis.plantProducts,
        combinationFingerprint: analysis.fingerprint,
      })
    }

    console.log(`Found ${matchedOrders.length} orders with valid combinations`)

    // 5. Group by combination fingerprint (minimum 5 orders per group)
    const productGroups = groupOrdersByCombination(matchedOrders, 5)
    console.log(`Created ${productGroups.length} combination groups with 5+ orders`)

    // 6. Extract metadata for filters
    const metadata = extractMetadata(matchedOrders)

    return NextResponse.json({
      groups: productGroups,
      totalMatchedOrders: matchedOrders.length,
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
