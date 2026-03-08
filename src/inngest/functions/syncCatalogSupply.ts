import { floridayInngest } from "../floriday-client"
import { syncAllKunstplantStock, isCatalogSupplySyncDisabled } from "@/lib/floriday/catalog-supply-service"
import { isStockSyncDisabled } from "@/lib/floriday/stock-sync-config"
import { supabase } from "@/lib/supabase/client"
import { insertSyncLogItems } from "@/lib/floriday/stock-sync-logging"

export const syncCatalogSupply = floridayInngest.createFunction(
  { id: "sync-catalog-supply", retries: 1 },
  { cron: "0 * * * *" },
  async ({ step }) => {
    // Kill switch check (both catalog supply and stock sync kill switches)
    const disabled = await step.run("check-kill-switch", () => {
      return isCatalogSupplySyncDisabled() || isStockSyncDisabled()
    })

    if (disabled) {
      return { skipped: true, reason: "Kill switch active" }
    }

    // Run the sync
    const startTime = Date.now()
    const result = await step.run("sync-all-weeks", () => syncAllKunstplantStock())
    const durationMs = Date.now() - startTime

    // Log to stock_sync_log
    const logEntry = await step.run("log-sync-result", async () => {
      const { data, error } = await supabase
        .schema('floriday')
        .from('stock_sync_log')
        .insert({
          trigger_type: 'cron_hourly',
          products_synced: result.synced,
          products_skipped: result.skipped,
          products_errored: result.errors,
          duration_ms: durationMs,
          details: {
            frozenWeeks: result.frozenWeeks,
          },
        })
        .select('id')
        .single()

      if (error) console.error('Failed to insert sync log:', error.message)
      return data
    })

    // Log per-product items
    if (logEntry?.id && result.details.length > 0) {
      await step.run("log-sync-items", async () => {
        await insertSyncLogItems(logEntry.id, result.details)
      })
    }

    // Cleanup old queue entries (synced/error > 24h) and old logs (> 30 days)
    await step.run("cleanup-old-entries", async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

      await Promise.all([
        supabase
          .schema('floriday')
          .from('stock_sync_queue')
          .delete()
          .in('status', ['synced', 'error'])
          .lt('created_at', oneDayAgo),

        supabase
          .schema('floriday')
          .from('stock_sync_log')
          .delete()
          .lt('created_at', thirtyDaysAgo),
      ])
    })

    return result
  }
)
