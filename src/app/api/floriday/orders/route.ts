import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

/**
 * GET /api/floriday/orders
 *
 * Dashboard data: order mappings, sync state, en recente logs.
 * Query params:
 *   - status: filter op processing_status (created, failed, skipped)
 *   - limit: max aantal orders (default 50)
 *   - offset: paginatie offset
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  try {
    // 1. Order mappings
    let ordersQuery = supabase
      .schema('floriday')
      .from('order_mapping')
      .select('*')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      ordersQuery = ordersQuery.eq('processing_status', status)
    }

    const { data: orders, error: ordersError } = await ordersQuery

    if (ordersError) throw ordersError

    // 2. Totalen per status
    const { data: statusCounts } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('processing_status')

    const counts = { created: 0, failed: 0, skipped: 0, total: 0 }
    for (const row of statusCounts || []) {
      counts.total++
      const s = row.processing_status as keyof typeof counts
      if (s in counts) counts[s]++
    }

    // 3. Sync state
    const { data: syncStates } = await supabase
      .schema('floriday')
      .from('sync_state')
      .select('*')
      .order('resource_name')

    // 4. Recente sync logs
    const { data: recentLogs } = await supabase
      .schema('floriday')
      .from('sync_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      orders: orders || [],
      counts,
      syncStates: syncStates || [],
      recentLogs: recentLogs || [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Floriday orders API error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
