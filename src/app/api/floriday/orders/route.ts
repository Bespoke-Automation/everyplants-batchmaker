import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

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

  const env = getFloridayEnv()

  try {
    // 1. Order mappings
    let ordersQuery = supabase
      .schema('floriday')
      .from('order_mapping')
      .select('*')
      .eq('environment', env)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      if (status === 'cancelled') {
        ordersQuery = ordersQuery.in('processing_status', ['cancelled', 'cancelled_for_correction'])
      } else {
        ordersQuery = ordersQuery.eq('processing_status', status)
      }
    }

    const { data: orders, error: ordersError } = await ordersQuery

    if (ordersError) throw ordersError

    // 2. Totalen per status
    const { data: statusCounts } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('processing_status')
      .eq('environment', env)

    const counts = { created: 0, failed: 0, skipped: 0, cancelled: 0, total: 0 }
    for (const row of statusCounts || []) {
      counts.total++
      const s = row.processing_status as string
      if (s === 'cancelled' || s === 'cancelled_for_correction') {
        counts.cancelled++
      } else if (s in counts) {
        (counts as Record<string, number>)[s]++
      }
    }

    // 3. Sync state
    const { data: syncStates } = await supabase
      .schema('floriday')
      .from('sync_state')
      .select('*')
      .eq('environment', env)
      .order('resource_name')

    // 4. Recente sync logs
    const { data: recentLogs } = await supabase
      .schema('floriday')
      .from('sync_log')
      .select('*')
      .eq('environment', env)
      .order('created_at', { ascending: false })
      .limit(20)

    return NextResponse.json({
      orders: orders || [],
      counts,
      syncStates: syncStates || [],
      recentLogs: recentLogs || [],
      env,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Floriday orders API error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
