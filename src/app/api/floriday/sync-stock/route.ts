import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { buildStockSnapshot } from '@/lib/floriday/stock-service'
import { getFloridayEnv } from '@/lib/floriday/config'

/**
 * GET /api/floriday/sync-stock
 * Retourneert de gecachede stocksnapshot uit Supabase.
 * Enrichment data (alt_sku, trade_item_id, vbn_code) zit al in de cache — wordt meeschreven bij POST.
 */
export async function GET() {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('floriday_stock_cache')
    .select('*')
    .order('name')

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}

/**
 * POST /api/floriday/sync-stock
 * Haalt actuele stock op uit Picqer en slaat snapshot op in Supabase.
 */
export async function POST() {
  try {
    const env = getFloridayEnv()
    const items = await buildStockSnapshot()

    // Enrichment data ophalen via de view (1 query i.p.v. 3)
    const productIds = items.map(i => i.picqer_product_id)
    const { data: mappings } = await supabase
      .schema('floriday')
      .from('enriched_product_mapping')
      .select('picqer_product_id, alt_sku, floriday_trade_item_id, vbn_product_code')
      .eq('environment', env)
      .eq('is_active', true)
      .in('picqer_product_id', productIds)

    const enrichMap = new Map(
      (mappings ?? []).map(m => [m.picqer_product_id, m])
    )

    const rows = items.map((item) => {
      const enrich = enrichMap.get(item.picqer_product_id)
      return {
        picqer_product_id: item.picqer_product_id,
        productcode: item.productcode,
        name: item.name,
        bulk_pick_stock: item.bulk_pick_stock,
        po_qty_this_week: item.po_qty_this_week,
        week_stock: item.week_stock,
        po_details: item.po_details,
        alt_sku: enrich?.alt_sku ?? null,
        floriday_trade_item_id: enrich?.floriday_trade_item_id ?? null,
        vbn_product_code: enrich?.vbn_product_code ?? null,
        synced_at: new Date().toISOString(),
      }
    })

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
