import { supabase } from '@/lib/supabase/client'
import type { CatalogSyncResult } from './catalog-supply-service'

const INSERT_CHUNK_SIZE = 500

/**
 * Insert per-product sync log items for a sync run.
 * Maps CatalogSyncResult[] to stock_sync_log_items rows.
 * Chunked insert (max 500 per batch) to stay within Supabase limits.
 */
export async function insertSyncLogItems(
  syncLogId: number | string,
  details: CatalogSyncResult[]
): Promise<void> {
  if (details.length === 0) {
    console.warn('insertSyncLogItems: details array is empty, skipping')
    return
  }

  // Ensure syncLogId is a number (Supabase PostgREST returns bigint as string)
  const logId = typeof syncLogId === 'string' ? parseInt(syncLogId, 10) : syncLogId

  console.log(`insertSyncLogItems: inserting ${details.length} items for sync_log_id=${logId}`)

  const rows = details.map(d => ({
    sync_log_id: logId,
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
    const { error, count } = await supabase
      .schema('floriday')
      .from('stock_sync_log_items')
      .insert(chunk)

    if (error) {
      console.error(`insertSyncLogItems: chunk ${i / INSERT_CHUNK_SIZE + 1} failed:`, JSON.stringify({
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        sampleRow: chunk[0],
      }))
    } else {
      console.log(`insertSyncLogItems: chunk ${i / INSERT_CHUNK_SIZE + 1} inserted (${chunk.length} rows)`)
    }
  }
}

function deriveStatus(d: CatalogSyncResult): 'synced' | 'skipped' | 'errored' {
  if (d.success) return 'synced'
  if (d.error?.includes('mapping')) return 'skipped'
  return 'errored'
}
