import { floridayInngest } from '../floriday-client'
import { supabase } from '@/lib/supabase/client'
import { isStockSyncDisabled } from '@/lib/floriday/stock-sync-config'
import { isCatalogSupplySyncDisabled, syncSelectedProductsBulk, type CatalogSyncResult } from '@/lib/floriday/catalog-supply-service'
import { getFloridayProducts, calcExpectedStockByWeek } from '@/lib/floriday/stock-service'
import { getWeeklyBaseSupplies } from '@/lib/floriday/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getNextNWeeks, weekKey } from '@/lib/floriday/utils'
import { insertSyncLogItems } from '@/lib/floriday/stock-sync-logging'

const SYNC_WEEKS = 6

/**
 * 6-hourly reconciliation: compares calculated stock with Floriday actuals.
 * Only syncs products where drift is detected (delta-only sync).
 *
 * Runs at 0:30, 6:30, 12:30, 18:30 UTC.
 */
export const reconcileFloridayStock = floridayInngest.createFunction(
  { id: 'reconcile-floriday-stock', retries: 1 },
  { cron: '30 */6 * * *' },
  async ({ step }) => {
    // Kill switch
    const disabled = await step.run('check-kill-switch', () => {
      return isStockSyncDisabled() || isCatalogSupplySyncDisabled()
    })

    if (disabled) {
      return { skipped: true, reason: 'Kill switch active' }
    }

    const startTime = Date.now()

    // 1. Get all mapped products
    const mappedProducts = await step.run('get-mapped-products', async () => {
      const env = getFloridayEnv()
      const { data } = await supabase
        .schema('floriday')
        .from('product_mapping')
        .select('picqer_product_id, floriday_trade_item_id')
        .eq('environment', env)
        .eq('is_active', true)

      return data ?? []
    })

    if (mappedProducts.length === 0) {
      return { skipped: true, reason: 'no_mapped_products' }
    }

    // 2. Fetch Floriday actual base supplies for all weeks
    const floridayActuals = await step.run('fetch-floriday-actuals', async () => {
      const weeks = getNextNWeeks(SYNC_WEEKS)
      const suppliesByWeek = new Map<string, Map<string, number>>()

      // Fetch all weeks in parallel
      const results = await Promise.all(
        weeks.map(async (w) => {
          try {
            const supplies = await getWeeklyBaseSupplies(w.year, w.week)
            return { week: w, supplies }
          } catch (err) {
            console.error(`Reconciliation: failed to fetch ${weekKey(w.year, w.week)}:`, err)
            return { week: w, supplies: [] }
          }
        })
      )

      for (const { week, supplies } of results) {
        const wk = weekKey(week.year, week.week)
        const map = new Map<string, number>()
        for (const s of supplies) {
          map.set(s.tradeItemId, s.numberOfPieces)
        }
        suppliesByWeek.set(wk, map)
      }

      // Convert to serializable format
      const result: Record<string, Record<string, number>> = {}
      for (const [wk, map] of suppliesByWeek) {
        result[wk] = Object.fromEntries(map)
      }
      return result
    })

    // 3. Calculate expected stock and detect drift
    const driftedProductIds = await step.run('detect-drift', async () => {
      const weeks = getNextNWeeks(SYNC_WEEKS)
      const drifted = new Set<number>()

      // Build trade item → picqer product map
      const tradeItemToProduct = new Map<string, number>()
      for (const m of mappedProducts) {
        tradeItemToProduct.set(m.floriday_trade_item_id, m.picqer_product_id)
      }

      // Check each mapped product (in batches of 3 for rate limiting)
      for (let i = 0; i < mappedProducts.length; i += 3) {
        const batch = mappedProducts.slice(i, i + 3)
        await Promise.all(
          batch.map(async (m) => {
            try {
              const weekStocks = await calcExpectedStockByWeek(m.picqer_product_id)

              for (const ws of weekStocks) {
                const wk = weekKey(ws.year, ws.week)
                const floridayWeek = floridayActuals[wk]
                if (!floridayWeek) continue

                const floridayQty = floridayWeek[m.floriday_trade_item_id] ?? 0
                if (floridayQty !== ws.totalStock) {
                  drifted.add(m.picqer_product_id)
                  break // One week mismatch is enough to trigger resync
                }
              }
            } catch (err) {
              console.error(`Reconciliation: calc failed for product ${m.picqer_product_id}:`, err)
              // Don't add to drift — might be transient error
            }
          })
        )
      }

      return [...drifted]
    })

    // 4. Sync drifted products
    let syncResult = { synced: 0, skipped: 0, errors: 0, frozenWeeks: [] as string[], details: [] as CatalogSyncResult[] }

    if (driftedProductIds.length > 0) {
      syncResult = await step.run('sync-drifted-products', async () => {
        console.log(`Reconciliation: ${driftedProductIds.length} products with drift, syncing...`)
        const result = await syncSelectedProductsBulk(driftedProductIds)
        return {
          synced: result.synced,
          skipped: result.skipped,
          errors: result.errors,
          frozenWeeks: result.frozenWeeks,
          details: result.details,
        }
      })
    }

    const durationMs = Date.now() - startTime

    // 5. Log result
    const logEntry = await step.run('log-reconciliation', async () => {
      const { data, error } = await supabase
        .schema('floriday')
        .from('stock_sync_log')
        .insert({
          trigger_type: 'reconciliation',
          products_synced: syncResult.synced,
          products_skipped: syncResult.skipped,
          products_errored: syncResult.errors,
          drift_detected: driftedProductIds.length,
          duration_ms: durationMs,
          details: {
            totalMapped: mappedProducts.length,
            driftedProductIds,
            frozenWeeks: syncResult.frozenWeeks,
          },
        })
        .select('id')
        .single()

      if (error) console.error('Failed to insert reconciliation log:', error.message)
      return data
    })

    // 6. Log per-product items
    if (logEntry?.id && syncResult.details.length > 0) {
      await step.run('log-reconciliation-items', async () => {
        await insertSyncLogItems(logEntry.id, syncResult.details)
      })
    }

    return {
      totalMapped: mappedProducts.length,
      driftDetected: driftedProductIds.length,
      synced: syncResult.synced,
      errors: syncResult.errors,
      duration_ms: durationMs,
    }
  }
)
