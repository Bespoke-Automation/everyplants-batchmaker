import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

/**
 * GET /api/floriday/mapped-products
 * Retourneert alle actieve producten uit product_mapping voor de zoekfunctie.
 */
export async function GET() {
  const env = getFloridayEnv()
  const { data, error } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id, picqer_product_code, floriday_trade_item_name, last_stock_sync_at')
    .eq('environment', env)
    .eq('is_active', true)
    .order('floriday_trade_item_name')

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: data ?? [] })
}
