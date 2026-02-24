// ══════════════════════════════════════════════════════════════
// Floriday Trade Item Sync
// ══════════════════════════════════════════════════════════════
//
// Synct alle Floriday trade items naar floriday.trade_items.
// Gebruikt de sync_state tabel om de laatste sequence bij te houden.
// Daarna beschikbaar voor auto-match op supplier_article_code.

import { supabase } from '@/lib/supabase/client'
import { syncAll } from '@/lib/floriday/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import type { FloridayTradeItem } from '@/lib/floriday/types'

const RESOURCE = 'trade-items'

export interface TradeItemSyncResult {
  success: boolean
  upserted: number
  lastSequence: number
  error?: string
}

async function getLastSequence(): Promise<number> {
  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('sync_state')
    .select('last_processed_sequence')
    .eq('resource_name', RESOURCE)
    .eq('environment', env)
    .single()
  return data?.last_processed_sequence ?? 0
}

async function saveLastSequence(seq: number, count: number): Promise<void> {
  const env = getFloridayEnv()
  await supabase
    .schema('floriday')
    .from('sync_state')
    .upsert(
      {
        resource_name: RESOURCE,
        environment: env,
        last_processed_sequence: seq,
        last_sync_completed_at: new Date().toISOString(),
        records_processed_last_run: count,
      },
      { onConflict: 'resource_name,environment' }
    )
}

export async function syncTradeItemsToSupabase(): Promise<TradeItemSyncResult> {
  const env = getFloridayEnv()
  const fromSeq = await getLastSequence()
  let totalUpserted = 0

  const lastSeq = await syncAll<FloridayTradeItem>(
    RESOURCE,
    fromSeq,
    async (batch) => {
      const rows = batch.map((item) => ({
        trade_item_id: item.tradeItemId,
        environment: env,
        supplier_article_code: item.supplierArticleCode ?? null,
        name: item.tradeItemName?.nl ?? null,
        vbn_product_code: item.vbnProductCode ?? null,
        sequence_number: item.sequenceNumber,
        last_modified: item.lastModifiedDateTime ?? null,
        synced_at: new Date().toISOString(),
      }))

      const { error } = await supabase
        .schema('floriday')
        .from('trade_items')
        .upsert(rows, { onConflict: 'trade_item_id,environment' })

      if (error) throw new Error(`Upsert trade_items mislukt: ${error.message}`)

      totalUpserted += rows.length
      console.log(`Trade items batch [${env}]: ${rows.length} upserted (seq t/m ${Math.max(...batch.map(i => i.sequenceNumber))})`)
    }
  )

  await saveLastSequence(lastSeq, totalUpserted)

  return { success: true, upserted: totalUpserted, lastSequence: lastSeq }
}

/**
 * Zoek een trade item op supplier_article_code (exact match).
 * Geeft null terug als niet gevonden.
 */
export async function findTradeItemByArticleCode(
  articleCode: string
): Promise<{ trade_item_id: string; name: string | null } | null> {
  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('trade_items')
    .select('trade_item_id, name')
    .eq('supplier_article_code', articleCode)
    .eq('environment', env)
    .limit(1)
    .single()

  return data ?? null
}
