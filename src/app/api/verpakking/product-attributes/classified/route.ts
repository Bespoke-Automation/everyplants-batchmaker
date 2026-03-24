import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/product-attributes/classified
 * Returns all classified products with fields needed for DefaultPackagingList.
 * Paginates internally to overcome Supabase 1000-row limit.
 */
export async function GET() {
  try {
    const products: Record<string, unknown>[] = []
    let offset = 0
    const PAGE_SIZE = 1000

    while (true) {
      const { data, error } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('id, productcode, product_name, default_packaging_id, shipping_unit_id, pot_size, height, image_url')
        .eq('classification_status', 'classified')
        .order('productcode')
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) throw error
      if (!data || data.length === 0) break
      products.push(...data)
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }

    return NextResponse.json({ products })
  } catch (error) {
    console.error('[product-attributes/classified] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch classified products' },
      { status: 500 }
    )
  }
}
