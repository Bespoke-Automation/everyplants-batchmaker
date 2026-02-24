// ══════════════════════════════════════════════════════════════
// Floriday Push Batch Service
// ══════════════════════════════════════════════════════════════
//
// Pusht de weekstock van een Picqer-product naar Floriday als Batch(es).
//
// Flow:
//   1. Zoek tradeItemId op via product_mapping (picqer_product_id)
//   2. Haal trade item op (voor packingConfiguration)
//   3. Haal Floriday warehouse op
//   4. Annuleer bestaande batch (indien aanwezig)
//   5. Maak batch aan: vandaag + bulk_pick_stock
//      + extra batch per PO met PO-datum
//   6. Sla batchId op in product_mapping

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from './config'
import {
  getTradeItem,
  getWarehouses,
  createBatch,
  cancelBatch,
} from './client'
import type { FloridayBatchCreate, FloridayPackingConfigurationInput } from './types'
import { calcBulkPickStock, getThisWeekPOs, type PoDetail } from './stock-service'
import { findTradeItemByArticleCode } from './sync/trade-item-sync'
import { getProductFull } from '@/lib/picqer/client'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875

export interface PushBatchResult {
  success: boolean
  batchesCreated: number
  batchIds: string[]
  tradeItemId: string
  error?: string
}

// ─── Warehouse cache (in-memory, geldig voor de levensduur van de server) ────

let _warehouseId: string | null = null

async function getFloridayWarehouseId(): Promise<string> {
  if (_warehouseId) return _warehouseId

  const warehouses = await getWarehouses()
  if (!warehouses.length) {
    throw new Error('Geen Floriday warehouse gevonden')
  }

  // Gebruik het eerste warehouse
  _warehouseId = warehouses[0].warehouseId
  return _warehouseId
}

// ─── Auto-match: Picqer product → Floriday trade item ─────────

/**
 * Probeert een Picqer product automatisch te matchen met een Floriday trade item
 * via de alternatieve SKU (productfield 4875) of als fallback de productcode.
 * Als een match gevonden wordt, wordt die opgeslagen in product_mapping.
 * Geeft het tradeItemId terug, of null als geen match gevonden.
 */
async function autoMapProduct(picqerProductId: number): Promise<string | null> {
  // Haal het volledige Picqer product op (met productfields)
  const product = await getProductFull(picqerProductId)

  // Probeer alternatieve SKU (field 4875) als primaire match-key
  const altSku = product.productfields?.find(
    f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
  )?.value

  const searchCodes = [altSku, product.productcode].filter(Boolean) as string[]

  let tradeItem: { trade_item_id: string; name: string | null } | null = null
  let matchedCode: string | null = null

  for (const code of searchCodes) {
    tradeItem = await findTradeItemByArticleCode(code)
    if (tradeItem) {
      matchedCode = code
      break
    }
  }

  if (!tradeItem) {
    console.warn(
      `Auto-match mislukt voor product ${picqerProductId} (${product.productcode}). ` +
      `Probeerde: ${searchCodes.join(', ')}. ` +
      `Zorg dat trade items gesynchroniseerd zijn via "Sync trade items".`
    )
    return null
  }

  // Sla de mapping op in product_mapping
  const env = getFloridayEnv()
  await supabase
    .schema('floriday')
    .from('product_mapping')
    .upsert(
      {
        picqer_product_id: picqerProductId,
        picqer_product_code: product.productcode,
        floriday_trade_item_id: tradeItem.trade_item_id,
        environment: env,
        floriday_supplier_article_code: matchedCode,
        floriday_trade_item_name: tradeItem.name,
        match_method: 'auto_match',
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_trade_item_id,environment' }
    )

  console.log(
    `Auto-match geslaagd: product ${picqerProductId} → trade item ${tradeItem.trade_item_id} ` +
    `(via "${matchedCode}")`
  )

  return tradeItem.trade_item_id
}

// ─── Hoofdfunctie ─────────────────────────────────────────────

export async function pushProductBatch(
  picqerProductId: number,
  bulkPickStock: number,
  poDetails: PoDetail[]
): Promise<PushBatchResult> {
  // 1. Zoek tradeItemId op in product_mapping
  const env = getFloridayEnv()
  const { data: mapping, error: mappingError } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('floriday_trade_item_id, floriday_batch_id')
    .eq('picqer_product_id', picqerProductId)
    .eq('environment', env)
    .eq('is_active', true)
    .single()

  let tradeItemId: string | null = mapping?.floriday_trade_item_id ?? null

  if (!tradeItemId) {
    // Probeer auto-match via alternatieve SKU / productcode
    tradeItemId = await autoMapProduct(picqerProductId)
  }

  if (!tradeItemId) {
    return {
      success: false,
      batchesCreated: 0,
      batchIds: [],
      tradeItemId: '',
      error:
        'Geen Floriday trade item gevonden voor dit product. ' +
        'Klik eerst op "Sync trade items" om de Floriday catalogus bij te werken.',
    }
  }
  const existingBatchId: string | null = mapping?.floriday_batch_id ?? null

  // 2. Haal trade item op voor packingConfiguration
  const tradeItem = await getTradeItem(tradeItemId)
  const primaryConfig = tradeItem.packingConfigurations.find(c => c.primary)
    ?? tradeItem.packingConfigurations[0]

  if (!primaryConfig) {
    return {
      success: false,
      batchesCreated: 0,
      batchIds: [],
      tradeItemId,
      error: 'Trade item heeft geen packingConfiguration',
    }
  }

  const packingConfig: FloridayPackingConfigurationInput = {
    piecesPerPackage: primaryConfig.piecesPerPackage,
    packageCode: primaryConfig.package.packageCode,
    packagesPerLayer: primaryConfig.packagesPerLayer,
    layersPerLoadCarrier: primaryConfig.layersPerLoadCarrier,
    loadCarrierType: primaryConfig.loadCarrier.loadCarrierType,
  }

  // 3. Haal warehouse op
  const warehouseId = await getFloridayWarehouseId()

  // 4. Annuleer bestaande batch
  if (existingBatchId) {
    try {
      await cancelBatch(existingBatchId)
      console.log(`Bestaande batch ${existingBatchId} geannuleerd`)
    } catch (err) {
      // Batch bestaat mogelijk niet meer — doorgaan
      console.warn(`Kon batch ${existingBatchId} niet annuleren:`, err)
    }
  }

  // 5. Maak batch(es) aan
  const today = new Date().toISOString().split('T')[0]
  const batchIds: string[] = []

  // Batch 1: huidige stock (excl. PPS)
  if (bulkPickStock > 0) {
    const batchId = crypto.randomUUID()
    const batch: FloridayBatchCreate = {
      batchId,
      batchDate: today,
      tradeItemId,
      numberOfPieces: bulkPickStock,
      packingConfiguration: packingConfig,
      warehouseId,
      batchReference: `Picqer sync ${today}`,
    }
    await createBatch(batch)
    batchIds.push(batchId)
    console.log(`Batch aangemaakt: ${batchId} (${bulkPickStock} st., vandaag)`)
  }

  // Batch 2..N: per PO
  for (const po of poDetails) {
    if (po.qty <= 0) continue
    const batchId = crypto.randomUUID()
    const batch: FloridayBatchCreate = {
      batchId,
      batchDate: po.delivery_date,
      tradeItemId,
      numberOfPieces: po.qty,
      packingConfiguration: packingConfig,
      warehouseId,
      batchReference: `PO ${po.purchaseorderid}`,
    }
    await createBatch(batch)
    batchIds.push(batchId)
    console.log(`PO-batch aangemaakt: ${batchId} (${po.qty} st., ${po.delivery_date})`)
  }

  if (!batchIds.length) {
    return {
      success: false,
      batchesCreated: 0,
      batchIds: [],
      tradeItemId,
      error: 'Geen batches aangemaakt (weekstock is 0)',
    }
  }

  // 6. Sla batchId op (eerste batch = primaire)
  await supabase
    .schema('floriday')
    .from('product_mapping')
    .update({
      floriday_batch_id: batchIds[0],
      last_synced_freestock: bulkPickStock,
      last_stock_sync_at: new Date().toISOString(),
    })
    .eq('picqer_product_id', picqerProductId)
    .eq('environment', env)

  return {
    success: true,
    batchesCreated: batchIds.length,
    batchIds,
    tradeItemId,
  }
}

// ─── Live variant (haalt zelf stock + POs op) ─────────────────

export interface PushBatchLiveResult extends PushBatchResult {
  bulkPickStock: number
  poQtyThisWeek: number
  weekStock: number
}

/**
 * Haalt live stock op uit Picqer voor één product en pusht direct naar Floriday.
 * Geen cache nodig — werkt ook voor producten die nog niet in de stock_cache staan.
 */
export async function pushProductBatchLive(
  picqerProductId: number
): Promise<PushBatchLiveResult> {
  const [bulkPickStock, poMap] = await Promise.all([
    calcBulkPickStock(picqerProductId),
    getThisWeekPOs(),
  ])

  const poDetails = poMap.get(picqerProductId) ?? []
  const poQtyThisWeek = poDetails.reduce((sum, p) => sum + p.qty, 0)

  const result = await pushProductBatch(picqerProductId, bulkPickStock, poDetails)

  return {
    ...result,
    bulkPickStock,
    poQtyThisWeek,
    weekStock: bulkPickStock + poQtyThisWeek,
  }
}
