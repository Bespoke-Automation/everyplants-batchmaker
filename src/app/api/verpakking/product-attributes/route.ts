import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/product-attributes?ids=1,2,3
 * Returns product attributes (custom fields) for a list of Picqer product IDs.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const idsParam = searchParams.get('ids')

  if (!idsParam) {
    return NextResponse.json({ attributes: {} })
  }

  const ids = idsParam
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id) && id > 0)

  if (ids.length === 0) {
    return NextResponse.json({ attributes: {} })
  }

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, product_type, pot_size, height, is_fragile, is_mixable')
    .in('picqer_product_id', ids)

  if (error) {
    console.error('[product-attributes] Error fetching product attributes:', error)
    return NextResponse.json(
      { error: 'Failed to fetch product attributes' },
      { status: 500 }
    )
  }

  // Index by picqer_product_id for easy lookup
  const attributes: Record<number, {
    productType: string | null
    potSize: number | null
    height: number | null
    isFragile: boolean
    isMixable: boolean
  }> = {}

  for (const row of data || []) {
    attributes[row.picqer_product_id] = {
      productType: row.product_type ?? null,
      potSize: row.pot_size ?? null,
      height: row.height ?? null,
      isFragile: row.is_fragile ?? false,
      isMixable: row.is_mixable ?? true,
    }
  }

  return NextResponse.json({ attributes })
}
