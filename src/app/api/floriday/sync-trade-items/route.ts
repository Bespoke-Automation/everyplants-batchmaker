import { NextResponse } from 'next/server'
import { syncTradeItemsToSupabase } from '@/lib/floriday/sync/trade-item-sync'

/**
 * POST /api/floriday/sync-trade-items
 *
 * Synct alle Floriday trade items naar floriday.trade_items.
 * Vereist voor auto-match van ongemapte producten op supplierArticleCode.
 * Incremental: slaat de laatste sequence op, herhaalde sync is snel.
 */
export async function POST() {
  try {
    const result = await syncTradeItemsToSupabase()
    return NextResponse.json({
      success: true,
      message: `${result.upserted} trade items gesynchroniseerd`,
      upserted: result.upserted,
      lastSequence: result.lastSequence,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Trade item sync error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
