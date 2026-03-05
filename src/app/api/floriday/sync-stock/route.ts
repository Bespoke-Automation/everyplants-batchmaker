import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { buildStockSnapshot } from '@/lib/floriday/stock-service'
import { getFloridayEnv } from '@/lib/floriday/config'

/**
 * GET /api/floriday/sync-stock
 * Retourneert de gecachede stocksnapshot uit Supabase, verrijkt met alt_sku, trade item ID en VBN code.
 */
export async function GET() {
  const env = getFloridayEnv()

  const [cacheResult, productIndexResult, mappingsResult, tradeItemsResult] = await Promise.all([
    supabase
      .schema('batchmaker')
      .from('floriday_stock_cache')
      .select('*')
      .order('name'),
    supabase
      .schema('floriday')
      .from('picqer_product_index')
      .select('picqer_product_id, alt_sku'),
    supabase
      .schema('floriday')
      .from('product_mapping')
      .select('picqer_product_id, floriday_trade_item_id, floriday_vbn_product_code')
      .eq('environment', env)
      .eq('is_active', true),
    supabase
      .schema('floriday')
      .from('trade_items')
      .select('trade_item_id, vbn_product_code')
      .eq('environment', env),
  ])

  if (cacheResult.error) {
    return NextResponse.json({ success: false, error: cacheResult.error.message }, { status: 500 })
  }

  // Build lookup maps
  const altSkuMap = new Map(
    (productIndexResult.data ?? []).map(p => [p.picqer_product_id, p.alt_sku as string | null])
  )
  const mappingMap = new Map(
    (mappingsResult.data ?? []).map(m => [
      m.picqer_product_id,
      { tradeItemId: m.floriday_trade_item_id, vbnCode: m.floriday_vbn_product_code },
    ])
  )
  const vbnMap = new Map(
    (tradeItemsResult.data ?? []).map(t => [t.trade_item_id, t.vbn_product_code as number | null])
  )

  // Enrich each cache item
  const enriched = (cacheResult.data ?? []).map(item => {
    const mapping = mappingMap.get(item.picqer_product_id)
    const vbnCode = mapping?.tradeItemId
      ? (vbnMap.get(mapping.tradeItemId) ?? mapping.vbnCode ?? null)
      : null

    return {
      ...item,
      alt_sku: altSkuMap.get(item.picqer_product_id) ?? null,
      floriday_trade_item_id: mapping?.tradeItemId ?? null,
      vbn_product_code: vbnCode,
    }
  })

  return NextResponse.json({ success: true, data: enriched })
}

/**
 * POST /api/floriday/sync-stock
 * Haalt actuele stock op uit Picqer en slaat snapshot op in Supabase.
 */
export async function POST() {
  try {
    const items = await buildStockSnapshot()

    const rows = items.map((item) => ({
      picqer_product_id: item.picqer_product_id,
      productcode: item.productcode,
      name: item.name,
      bulk_pick_stock: item.bulk_pick_stock,
      po_qty_this_week: item.po_qty_this_week,
      week_stock: item.week_stock,
      po_details: item.po_details,
      synced_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .schema('batchmaker')
      .from('floriday_stock_cache')
      .upsert(rows, { onConflict: 'picqer_product_id' })

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `${items.length} producten gesynchroniseerd`,
      count: items.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Stock sync error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
