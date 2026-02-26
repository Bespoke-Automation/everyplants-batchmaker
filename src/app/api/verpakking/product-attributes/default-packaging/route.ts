import { NextRequest, NextResponse } from 'next/server'
import { updateDefaultPackaging } from '@/lib/supabase/productAttributes'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/verpakking/product-attributes/default-packaging
 * Sets or clears the default packaging for a product.
 * Body: { productAttributeId: string, packagingId: string | null }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { productAttributeId, packagingId } = body

    if (!productAttributeId || typeof productAttributeId !== 'string') {
      return NextResponse.json(
        { error: 'productAttributeId is required and must be a string' },
        { status: 400 }
      )
    }

    if (packagingId !== null && typeof packagingId !== 'string') {
      return NextResponse.json(
        { error: 'packagingId must be a string or null' },
        { status: 400 }
      )
    }

    await updateDefaultPackaging(productAttributeId, packagingId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[default-packaging] Error updating default packaging:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update default packaging' },
      { status: 500 }
    )
  }
}
