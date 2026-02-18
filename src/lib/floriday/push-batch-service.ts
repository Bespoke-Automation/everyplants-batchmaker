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
import {
  getTradeItem,
  getWarehouses,
  createBatch,
  cancelBatch,
} from './client'
import type { FloridayBatchCreate, FloridayPackingConfigurationInput } from './types'
import type { PoDetail } from './stock-service'

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

// ─── Hoofdfunctie ─────────────────────────────────────────────

export async function pushProductBatch(
  picqerProductId: number,
  bulkPickStock: number,
  poDetails: PoDetail[]
): Promise<PushBatchResult> {
  // 1. Zoek tradeItemId op in product_mapping
  const { data: mapping, error: mappingError } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('floriday_trade_item_id, floriday_batch_id')
    .eq('picqer_product_id', picqerProductId)
    .eq('is_active', true)
    .single()

  if (mappingError || !mapping?.floriday_trade_item_id) {
    return {
      success: false,
      batchesCreated: 0,
      batchIds: [],
      tradeItemId: '',
      error: 'Geen Floriday tradeItemId gevonden voor dit product. Zorg dat het product gemapt is.',
    }
  }

  const tradeItemId: string = mapping.floriday_trade_item_id
  const existingBatchId: string | null = mapping.floriday_batch_id

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

  return {
    success: true,
    batchesCreated: batchIds.length,
    batchIds,
    tradeItemId,
  }
}
