import { floridayInngest } from "../floriday-client"
import { syncProductIndex } from "@/lib/floriday/mappers/product-resolver"
import { syncTradeItemsToSupabase } from "@/lib/floriday/sync/trade-item-sync"
import { bulkAutoMap } from "@/lib/floriday/catalog-sync"
import { isCatalogSupplySyncDisabled } from "@/lib/floriday/catalog-supply-service"
import { isStockSyncDisabled } from "@/lib/floriday/stock-sync-config"
import { supabase } from "@/lib/supabase/client"

/**
 * Dagelijkse catalogus sync pipeline (4:00 UTC / 6:00 CET).
 *
 * Ververst de "foundation" zodat de uurlijkse stock sync
 * altijd met verse mappings werkt:
 *   1. Product index (alt_sku's uit Picqer)
 *   2. Trade items (Floriday catalogus)
 *   3. Bulk auto-map (ongemapte producten koppelen)
 */
export const syncFloridayCatalog = floridayInngest.createFunction(
  { id: "sync-floriday-catalog", retries: 1 },
  { cron: "0 4 * * *" },
  async ({ step }) => {
    // Kill switch check
    const disabled = await step.run("check-kill-switch", () => {
      return isCatalogSupplySyncDisabled() || isStockSyncDisabled()
    })

    if (disabled) {
      return { skipped: true, reason: "Kill switch active" }
    }

    const startTime = Date.now()

    // Step 1: Sync product index (alt_sku's uit Picqer)
    const indexResult = await step.run("sync-product-index", () =>
      syncProductIndex()
    )

    // Step 2: Sync trade items (Floriday catalogus)
    const tradeItemResult = await step.run("sync-trade-items", () =>
      syncTradeItemsToSupabase()
    )

    // Step 3: Bulk auto-map ongemapte producten
    const autoMapResult = await step.run("bulk-auto-map", () =>
      bulkAutoMap()
    )

    const durationMs = Date.now() - startTime

    // Step 4: Log resultaten naar stock_sync_log + per-product items
    const logEntry = await step.run("log-results", async () => {
      const { data, error } = await supabase
        .schema('floriday')
        .from('stock_sync_log')
        .insert({
          trigger_type: 'daily_catalog_sync',
          products_synced: autoMapResult.mapped,
          products_skipped: autoMapResult.noMatch + autoMapResult.alreadyMapped,
          products_errored: 0,
          duration_ms: durationMs,
          details: {
            productIndex: { synced: indexResult.synced },
            tradeItems: {
              upserted: tradeItemResult.upserted,
              lastSequence: tradeItemResult.lastSequence,
            },
            autoMap: {
              newMappings: autoMapResult.mapped,
              alreadyMapped: autoMapResult.alreadyMapped,
              noMatch: autoMapResult.noMatch,
            },
          },
        })
        .select('id')
        .single()

      if (error) console.error('Failed to insert catalog sync log:', error.message)
      return data
    })

    // Per-product log items (mapped + no_match)
    if (logEntry?.id && autoMapResult.details.length > 0) {
      await step.run("log-sync-items", async () => {
        const logId = typeof logEntry.id === 'string'
          ? parseInt(logEntry.id, 10)
          : logEntry.id

        const items = autoMapResult.details.map(d => ({
          sync_log_id: logId,
          picqer_product_id: d.picqerProductId,
          productcode: d.productcode,
          name: d.name,
          trade_item_id: d.tradeItemId ?? null,
          status: d.status === 'mapped' ? 'synced' : 'skipped',
          error_message: d.status === 'no_match' ? 'Geen matching trade item' : null,
          week_data: [],
        }))

        for (let i = 0; i < items.length; i += 500) {
          const chunk = items.slice(i, i + 500)
          const { error } = await supabase
            .schema('floriday')
            .from('stock_sync_log_items')
            .insert(chunk)

          if (error) {
            console.error(`Catalog sync log items chunk ${i / 500 + 1} failed:`, error.message)
          }
        }
      })
    }

    // Step 5: Cleanup old log entries (> 30 dagen)
    await step.run("cleanup-old-entries", async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      await supabase
        .schema('floriday')
        .from('stock_sync_log')
        .delete()
        .lt('created_at', thirtyDaysAgo)
    })

    return {
      productIndex: indexResult,
      tradeItems: tradeItemResult,
      autoMap: {
        mapped: autoMapResult.mapped,
        noMatch: autoMapResult.noMatch,
        alreadyMapped: autoMapResult.alreadyMapped,
      },
      durationMs,
    }
  }
)
