import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/verpakking/product-attributes/default-packaging/bulk
 * Sets or clears the default packaging for multiple products at once.
 * Body: { productAttributeIds: string[], packagingId: string | null }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { productAttributeIds, packagingId } = body

    if (!Array.isArray(productAttributeIds) || productAttributeIds.length === 0) {
      return NextResponse.json(
        { error: 'productAttributeIds must be a non-empty array' },
        { status: 400 }
      )
    }

    if (productAttributeIds.length > 5000) {
      return NextResponse.json(
        { error: 'Maximum 5000 producten per keer' },
        { status: 400 }
      )
    }

    if (packagingId !== null && typeof packagingId !== 'string') {
      return NextResponse.json(
        { error: 'packagingId must be a string or null' },
        { status: 400 }
      )
    }

    // Update in batches of 500 (Supabase .in() limit)
    let updated = 0
    for (let i = 0; i < productAttributeIds.length; i += 500) {
      const batch = productAttributeIds.slice(i, i + 500)
      const { error, count } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .update({ default_packaging_id: packagingId })
        .in('id', batch)

      if (error) {
        console.error(`[default-packaging/bulk] Batch error at offset ${i}:`, error)
        throw error
      }
      updated += count ?? batch.length
    }

    return NextResponse.json({ success: true, updated })
  } catch (error) {
    console.error('[default-packaging/bulk] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to bulk update default packaging' },
      { status: 500 }
    )
  }
}
