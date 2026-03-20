import { NextResponse } from 'next/server'
import { fetchPicklist, fetchOrder } from '@/lib/picqer/client'
import { previewAdvice } from '@/lib/engine/packagingEngine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/engine/preview
 * Dry-run engine calculation for a picklist — no persistence, no tags.
 *
 * Body: { picklistId: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { picklistId } = body

    if (!picklistId || typeof picklistId !== 'number') {
      return NextResponse.json(
        { error: 'picklistId is required and must be a number' },
        { status: 400 }
      )
    }

    // 1. Fetch picklist from Picqer
    const picklist = await fetchPicklist(picklistId)

    if (!picklist.products || picklist.products.length === 0) {
      return NextResponse.json(
        { error: 'Picklist has no products' },
        { status: 422 }
      )
    }

    // 2. Fetch order for country code
    const order = await fetchOrder(picklist.idorder)
    const countryCode = order.deliverycountry?.toUpperCase() || 'NL'

    // 3. Map picklist products to OrderProduct[]
    const products = picklist.products.map(p => ({
      picqer_product_id: p.idproduct,
      productcode: p.productcode,
      quantity: p.amount,
    }))

    // 4. Run engine preview (no persistence)
    const result = await previewAdvice(products, countryCode)

    return NextResponse.json({
      success: true,
      picklist: {
        idpicklist: picklist.idpicklist,
        picklistid: picklist.picklistid,
        idorder: picklist.idorder,
      },
      order: {
        idorder: order.idorder,
        orderid: order.orderid,
        deliveryname: order.deliveryname,
        deliverycountry: countryCode,
        deliverycity: order.deliverycity,
      },
      products: products.map(p => ({
        ...p,
        name: picklist.products.find(pp => pp.idproduct === p.picqer_product_id)?.name || '',
      })),
      preview: result,
    })
  } catch (error) {
    console.error('[engine/preview] Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to preview packaging advice',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
