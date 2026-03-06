import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/floriday/stock-sync-status
 *
 * Read-only monitoring endpoint voor de real-time stock sync pipeline.
 * Retourneert queue status, recente runs, en foutstatistieken.
 */
export async function GET() {
  try {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    const [
      { data: lastSuccess },
      { data: pendingItems, count: queueSize },
      { data: todayLogs },
      { data: recentRuns },
    ] = await Promise.all([
      // 1. Laatste succesvolle sync run
      supabase
        .schema('floriday')
        .from('stock_sync_log')
        .select('trigger_type, created_at, products_synced, duration_ms')
        .gt('products_synced', 0)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),

      // 2. Pending queue items
      supabase
        .schema('floriday')
        .from('stock_sync_queue')
        .select('id, picqer_product_id, trigger_event, created_at', { count: 'exact' })
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50),

      // 3. Fouten en drift vandaag
      supabase
        .schema('floriday')
        .from('stock_sync_log')
        .select('products_errored, drift_detected')
        .gte('created_at', todayStart.toISOString()),

      // 4. Recente runs
      supabase
        .schema('floriday')
        .from('stock_sync_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const errorsToday = (todayLogs || []).reduce((sum, l) => sum + (l.products_errored || 0), 0)
    const driftDetectedToday = (todayLogs || []).reduce((sum, l) => sum + (l.drift_detected || 0), 0)

    return NextResponse.json({
      lastSuccessfulSync: lastSuccess || null,
      queueSize: queueSize ?? 0,
      errorsToday,
      driftDetectedToday,
      recentRuns: recentRuns || [],
      pendingQueue: pendingItems || [],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Stock sync status API error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
