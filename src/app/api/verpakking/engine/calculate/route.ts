import { NextResponse } from 'next/server'
import { calculateAdvice } from '@/lib/engine/packagingEngine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/engine/calculate
 * Calculates packaging advice for an order.
 *
 * Body: {
 *   orderId: number,
 *   picklistId?: number,
 *   products: { picqer_product_id: number, productcode: string, quantity: number }[]
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { orderId, picklistId, products, shippingProviderProfileId, countryCode } = body

    // Validate required fields
    if (!orderId || typeof orderId !== 'number') {
      return NextResponse.json(
        { error: 'orderId is required and must be a number' },
        { status: 400 }
      )
    }

    if (!products || !Array.isArray(products) || products.length === 0) {
      return NextResponse.json(
        { error: 'products is required and must be a non-empty array' },
        { status: 400 }
      )
    }

    // Validate each product entry
    for (const product of products) {
      if (!product.picqer_product_id || typeof product.picqer_product_id !== 'number') {
        return NextResponse.json(
          { error: 'Each product must have a valid picqer_product_id (number)' },
          { status: 400 }
        )
      }
      if (!product.productcode || typeof product.productcode !== 'string') {
        return NextResponse.json(
          { error: 'Each product must have a valid productcode (string)' },
          { status: 400 }
        )
      }
      if (!product.quantity || typeof product.quantity !== 'number' || product.quantity < 1) {
        return NextResponse.json(
          { error: 'Each product must have a valid quantity (number >= 1)' },
          { status: 400 }
        )
      }
    }

    // Validate countryCode if provided (optional for backward compatibility)
    const VALID_COUNTRY_CODES = ['NL', 'BE', 'DE', 'FR', 'AT', 'LU', 'SE', 'IT', 'ES']
    if (countryCode !== undefined && countryCode !== null) {
      if (typeof countryCode !== 'string' || !VALID_COUNTRY_CODES.includes(countryCode.toUpperCase())) {
        return NextResponse.json(
          { error: `countryCode must be one of: ${VALID_COUNTRY_CODES.join(', ')}` },
          { status: 400 }
        )
      }
    }

    console.log(`[engine/calculate] Calculating advice for order ${orderId} with ${products.length} products${countryCode ? ` (country: ${countryCode})` : ''}`)

    const advice = await calculateAdvice(orderId, picklistId, products, shippingProviderProfileId, countryCode?.toUpperCase())

    return NextResponse.json({ success: true, advice })
  } catch (error) {
    console.error('[engine/calculate] Error:', error)
    return NextResponse.json(
      {
        error: 'Failed to calculate packaging advice',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
