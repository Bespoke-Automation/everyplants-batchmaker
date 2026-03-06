import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/product-mapping
 *
 * Handmatige mapping van Picqer product naar Floriday trade item.
 * Upsert op picqer_product_id + environment.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { picqerProductId, tradeItemId } = body

    if (!picqerProductId || !tradeItemId) {
      return NextResponse.json(
        { success: false, error: 'picqerProductId en tradeItemId zijn verplicht' },
        { status: 400 }
      )
    }

    const env = getFloridayEnv()

    // Haal trade item details op
    const { data: tradeItem, error: tiError } = await supabase
      .schema('floriday')
      .from('trade_items')
      .select('trade_item_id, supplier_article_code, name, vbn_product_code')
      .eq('trade_item_id', tradeItemId)
      .eq('environment', env)
      .single()

    if (tiError || !tradeItem) {
      return NextResponse.json(
        { success: false, error: 'Trade item niet gevonden' },
        { status: 404 }
      )
    }

    // Haal Picqer product code op uit index
    const { data: picqerProduct } = await supabase
      .schema('floriday')
      .from('picqer_product_index')
      .select('productcode')
      .eq('picqer_product_id', picqerProductId)
      .single()

    // Upsert in product_mapping
    const { error: upsertError } = await supabase
      .schema('floriday')
      .from('product_mapping')
      .upsert(
        {
          picqer_product_id: picqerProductId,
          picqer_product_code: picqerProduct?.productcode ?? null,
          floriday_trade_item_id: tradeItem.trade_item_id,
          floriday_trade_item_name: tradeItem.name,
          floriday_supplier_article_code: tradeItem.supplier_article_code,
          floriday_vbn_product_code: tradeItem.vbn_product_code,
          match_method: 'manual',
          is_active: true,
          environment: env,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'picqer_product_id' }
      )

    if (upsertError) {
      console.error('Product mapping upsert error:', upsertError)
      return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      mapping: {
        picqerProductId,
        tradeItemId: tradeItem.trade_item_id,
        tradeItemName: tradeItem.name,
        supplierArticleCode: tradeItem.supplier_article_code,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
