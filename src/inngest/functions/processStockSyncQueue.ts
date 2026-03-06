import { inngest } from '../client'
import { supabase } from '@/lib/supabase/client'
import { syncSelectedProductsBulk } from '@/lib/floriday/catalog-supply-service'
import { isStockSyncDisabled } from '@/lib/floriday/stock-sync-config'

/**
 * Debounced processor for the stock sync queue.
 *
 * Triggered by 'floriday/stock-sync.requested' events from the webhook endpoint.
 * Debounce: waits 10s after last event, max 30s total. This means 20 stock changes
 * within 10 seconds result in 1 Inngest run with all products deduplicated.
 */
export const processStockSyncQueue = inngest.createFunction(
  {
    id: 'process-floriday-stock-queue',
    debounce: { period: '10s', timeout: '30s' },
    retries: 2,
  },
  { event: 'floriday/stock-sync.requested' },
  async ({ step }) => {
    // Kill switch
    const disabled = await step.run('check-kill-switch', () => {
      return isStockSyncDisabled()
    })

    if (disabled) {
      return { skipped: true, reason: 'FLORIDAY_STOCK_SYNC_DISABLED=true' }
    }

    // 1. Fetch pending items from queue
    const pendingItems = await step.run('fetch-pending-queue', async () => {
      const { data, error } = await supabase
        .schema('floriday')
        .from('stock_sync_queue')
        .select('id, picqer_product_id')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(500)

      if (error) throw new Error(`Queue fetch error: ${error.message}`)
      return data ?? []
    })

    if (pendingItems.length === 0) {
      return { skipped: true, reason: 'empty_queue' }
    }

    // Deduplicate product IDs
    const queueIds = pendingItems.map(i => i.id)
    const productIds = [...new Set(pendingItems.map(i => i.picqer_product_id))]

    // 2. Mark as processing
    await step.run('mark-processing', async () => {
      const { error } = await supabase
        .schema('floriday')
        .from('stock_sync_queue')
        .update({ status: 'processing' })
        .in('id', queueIds)

      if (error) console.error('Failed to mark queue items as processing:', error.message)
    })

    // 3. Sync to Floriday
    const startTime = Date.now()
    const syncResult = await step.run('sync-to-floriday', async () => {
      return syncSelectedProductsBulk(productIds)
    })

    const durationMs = Date.now() - startTime

    // 4. Update queue status based on sync results
    await step.run('update-queue-status', async () => {
      // Build a set of errored product IDs
      const erroredProductIds = new Set(
        syncResult.details
          .filter(d => !d.success)
          .map(d => d.picqerProductId)
      )

      // Update each item based on its product's sync result
      const syncedIds = pendingItems
        .filter(i => !erroredProductIds.has(i.picqer_product_id))
        .map(i => i.id)

      const erroredIds = pendingItems
        .filter(i => erroredProductIds.has(i.picqer_product_id))
        .map(i => i.id)

      if (syncedIds.length > 0) {
        await supabase
          .schema('floriday')
          .from('stock_sync_queue')
          .update({ status: 'synced', processed_at: new Date().toISOString() })
          .in('id', syncedIds)
      }

      if (erroredIds.length > 0) {
        await supabase
          .schema('floriday')
          .from('stock_sync_queue')
          .update({
            status: 'error',
            error_message: 'Sync failed — check stock_sync_log for details',
            processed_at: new Date().toISOString(),
          })
          .in('id', erroredIds)
      }
    })

    // 5. Log sync result
    await step.run('log-sync-result', async () => {
      await supabase
        .schema('floriday')
        .from('stock_sync_log')
        .insert({
          trigger_type: 'webhook',
          products_synced: syncResult.synced,
          products_skipped: syncResult.skipped,
          products_errored: syncResult.errors,
          duration_ms: durationMs,
          details: {
            productIds,
            frozenWeeks: syncResult.frozenWeeks,
          },
        })
    })

    return {
      synced: syncResult.synced,
      skipped: syncResult.skipped,
      errors: syncResult.errors,
      products: productIds.length,
      duration_ms: durationMs,
    }
  }
)
