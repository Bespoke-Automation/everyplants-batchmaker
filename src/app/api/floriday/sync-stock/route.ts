import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { buildStockSnapshot } from '@/lib/floriday/stock-service'

/**
 * GET /api/floriday/sync-stock
 * Retourneert de gecachede stocksnapshot uit Supabase.
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
