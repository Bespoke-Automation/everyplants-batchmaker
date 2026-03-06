import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

export const dynamic = 'force-dynamic'

/**
 * GET /api/floriday/trade-items/search?q=xxx
 *
 * Zoekt in floriday.trade_items op naam of supplier_article_code.
 * Returns max 20 resultaten.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim()
    if (!q || q.length < 2) {
      return NextResponse.json({ success: false, error: 'Zoekterm moet minimaal 2 tekens zijn' }, { status: 400 })
    }

    const env = getFloridayEnv()
    const pattern = `%${q}%`

    const { data, error } = await supabase
      .schema('floriday')
      .from('trade_items')
      .select('trade_item_id, supplier_article_code, name, vbn_product_code')
      .eq('environment', env)
      .or(`name.ilike.${pattern},supplier_article_code.ilike.${pattern}`)
      .limit(20)

    if (error) {
      console.error('Trade items search error:', error)
      return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, tradeItems: data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
