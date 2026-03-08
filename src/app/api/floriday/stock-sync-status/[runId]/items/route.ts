import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/floriday/stock-sync-status/[runId]/items
 *
 * Lazy-load per-product sync details for a specific sync run.
 * Returns items ordered: errored first, then skipped, then synced.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const id = parseInt(runId, 10)

  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid runId' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .schema('floriday')
      .from('stock_sync_log_items')
      .select('*')
      .eq('sync_log_id', id)
      .order('status', { ascending: true }) // errored < skipped < synced alphabetically
      .order('productcode', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ items: data ?? [] })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
