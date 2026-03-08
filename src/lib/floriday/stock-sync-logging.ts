import { supabase } from '@/lib/supabase/client'
import type { CatalogSyncResult } from './catalog-supply-service'

const INSERT_CHUNK_SIZE = 500

/**
 * Insert per-product sync log items for a sync run.
 * Maps CatalogSyncResult[] to stock_sync_log_items rows.
 * Chunked insert (max 500 per batch) to stay within Supabase limits.
 */
export async function insertSyncLogItems(
  syncLogId: number,
  details: CatalogSyncResult[]
): Promise<void> {
  if (details.length === 0) return

  const rows = details.map(d => ({
    sync_log_id: syncLogId,
    picqer_product_id: d.picqerProductId,
    productcode: d.productcode ?? null,
    name: d.name ?? null,
    trade_item_id: d.tradeItemId ?? null,
    status: deriveStatus(d),
    error_message: d.error ?? null,
    week_data: d.weekResults ?? [],
  }))

  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE)
    const { error } = await supabase
      .schema('floriday')
      .from('stock_sync_log_items')
      .insert(chunk)

    if (error) {
      console.error(`Failed to insert sync log items (chunk ${i / INSERT_CHUNK_SIZE + 1}):`, error.message)
    }
  }
}

function deriveStatus(d: CatalogSyncResult): 'synced' | 'skipped' | 'errored' {
  if (d.success) return 'synced'
  if (d.error?.includes('mapping')) return 'skipped'
  return 'errored'
}
