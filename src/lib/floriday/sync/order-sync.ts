// ══════════════════════════════════════════════════════════════
// Order Sync: Floriday Sales Orders → Picqer Orders
// ══════════════════════════════════════════════════════════════
//
// Orchestrator die:
// 1. Warehouse cache ververst (voor afleveradres resolutie)
// 2. Sales orders synct via sequence-based polling
// 3. Per order: fulfillment ophaalt, mapt, en in Picqer aanmaakt
// 4. Resultaten logt in floriday.order_mapping en floriday.sync_log

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import {
  syncAll,
  syncFulfillmentOrders,
  getWarehouses,
  getTradeItem,
} from '@/lib/floriday/client'
import { createOrder, processOrder, addOrderTag, getTags, updateOrderFields } from '@/lib/picqer/client'
import { mapSalesOrderToPicqer } from '@/lib/floriday/mappers/order-mapper'
import type { FloridaySalesOrder, FloridayFulfillmentOrder } from '@/lib/floriday/types'

// ─── Types ──────────────────────────────────────────────────

export interface SyncResult {
  success: boolean
  ordersProcessed: number
  ordersCreated: number
  ordersFailed: number
  ordersSkipped: number
  errors: Array<{ salesOrderId: string; error: string }>
  duration_ms: number
}

// ─── Warehouse Cache ────────────────────────────────────────

/**
 * Refresh the warehouse GLN→address cache from Floriday.
 */
export async function refreshWarehouseCache(): Promise<number> {
  const env = getFloridayEnv()
  console.log(`Refreshing warehouse cache [${env}]...`)
  const warehouses = await getWarehouses()

  const rows = warehouses
    .filter(w => w.location?.gln)
    .map(w => ({
      gln: w.location.gln,
      environment: env,
      warehouse_id: w.warehouseId,
      name: w.name,
      address_line: w.location.address?.addressLine || null,
      postal_code: w.location.address?.postalCode || null,
      city: w.location.address?.city || null,
      country_code: w.location.address?.countryCode || 'NL',
      services: w.services || [],
      updated_at: new Date().toISOString(),
    }))

  if (rows.length > 0) {
    const { error } = await supabase
      .schema('floriday')
      .from('warehouse_cache')
      .upsert(rows, { onConflict: 'gln,environment' })

    if (error) {
      console.error('Error upserting warehouse cache:', error)
    }
  }

  console.log(`Warehouse cache bijgewerkt [${env}]: ${rows.length} locaties`)
  return rows.length
}

// ─── Floriday Tag Lookup ────────────────────────────────────

let floridayTagId: number | null = null

async function getFloridayTagId(): Promise<number | null> {
  if (floridayTagId) return floridayTagId

  const tags = await getTags()
  const tag = tags.find(t => t.title === 'Floriday')
  if (tag) {
    floridayTagId = tag.idtag
    return tag.idtag
  }

  console.warn('Tag "Floriday" niet gevonden in Picqer')
  return null
}

// ─── Main Sync ──────────────────────────────────────────────

/**
 * Sync all new sales orders from Floriday and create them in Picqer.
 */
export async function syncOrders(): Promise<SyncResult> {
  const env = getFloridayEnv()
  const startTime = Date.now()
  const errors: SyncResult['errors'] = []
  let ordersProcessed = 0
  let ordersCreated = 0
  let ordersFailed = 0
  let ordersSkipped = 0

  try {
    // 1. Refresh warehouse cache
    await refreshWarehouseCache()

    // 2. Get current sequence for sales orders
    const { data: syncState } = await supabase
      .schema('floriday')
      .from('sync_state')
      .select('last_processed_sequence')
      .eq('resource_name', 'sales-orders')
      .eq('environment', env)
      .single()

    const fromSequence = syncState?.last_processed_sequence || 0

    // 3. Sync fulfillment orders first (we need them for references)
    const { data: foSyncState } = await supabase
      .schema('floriday')
      .from('sync_state')
      .select('last_processed_sequence')
      .eq('resource_name', 'fulfillment-orders')
      .eq('environment', env)
      .single()

    const foFromSequence = foSyncState?.last_processed_sequence || 0
    const fulfillmentOrders: FloridayFulfillmentOrder[] = []

    await syncAll<FloridayFulfillmentOrder>(
      'fulfillment-orders',
      foFromSequence,
      async (results, maxSeq) => {
        fulfillmentOrders.push(...results)
        await supabase
          .schema('floriday')
          .from('sync_state')
          .upsert(
            {
              resource_name: 'fulfillment-orders',
              environment: env,
              last_processed_sequence: maxSeq,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'resource_name,environment' }
          )
      }
    )

    // Build salesOrderId → FulfillmentOrder lookup
    const foBySOId = buildFulfillmentLookup(fulfillmentOrders)

    // 4. Sync sales orders
    await syncAll<FloridaySalesOrder>(
      'sales-orders',
      fromSequence,
      async (results, maxSeq) => {
        for (const salesOrder of results) {
          ordersProcessed++

          const result = await processSalesOrder(salesOrder, foBySOId)

          if (result === 'created') ordersCreated++
          else if (result === 'skipped') ordersSkipped++
          else if (result === 'failed') {
            ordersFailed++
            // Error details are in order_mapping
          }
        }

        // Update sequence
        await supabase
          .schema('floriday')
          .from('sync_state')
          .upsert(
            {
              resource_name: 'sales-orders',
              environment: env,
              last_processed_sequence: maxSeq,
              last_sync_completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'resource_name,environment' }
          )
      }
    )

    const duration_ms = Date.now() - startTime

    // 5. Log sync result
    await logSync('sales-orders', 'sync', 'success', {
      ordersProcessed,
      ordersCreated,
      ordersFailed,
      ordersSkipped,
    }, duration_ms)

    return {
      success: true,
      ordersProcessed,
      ordersCreated,
      ordersFailed,
      ordersSkipped,
      errors,
      duration_ms,
    }
  } catch (error) {
    const duration_ms = Date.now() - startTime
    const message = error instanceof Error ? error.message : 'Unknown error'

    await logSync('sales-orders', 'sync', 'error', { error: message }, duration_ms)

    return {
      success: false,
      ordersProcessed,
      ordersCreated,
      ordersFailed,
      ordersSkipped,
      errors: [{ salesOrderId: 'sync', error: message }],
      duration_ms,
    }
  }
}

// ─── Process Single Order ───────────────────────────────────

/**
 * Process a single Floriday sales order into Picqer.
 */
export async function processSalesOrder(
  salesOrder: FloridaySalesOrder,
  fulfillmentLookup: Map<string, FloridayFulfillmentOrder>
): Promise<'created' | 'skipped' | 'failed'> {
  const env = getFloridayEnv()
  const salesOrderId = salesOrder.salesOrderId

  try {
    // Check if already processed
    const { data: existing } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('processing_status')
      .eq('floriday_sales_order_id', salesOrderId)
      .eq('environment', env)
      .single()

    if (existing && existing.processing_status === 'created') {
      console.log(`Order ${salesOrderId} already created, skipping`)
      return 'skipped'
    }

    // Only process COMMITTED orders
    if (salesOrder.status !== 'COMMITTED') {
      // Store the mapping for tracking but don't process
      await upsertOrderMapping(salesOrder, null, 'skipped', `Status is ${salesOrder.status}`)
      return 'skipped'
    }

    // Map to Picqer
    const fulfillmentOrder = fulfillmentLookup.get(salesOrderId)
    const mapResult = await mapSalesOrderToPicqer(salesOrder, fulfillmentOrder)

    if (!mapResult.success || !mapResult.payload) {
      await upsertOrderMapping(salesOrder, null, 'failed', mapResult.error || 'Mapping failed')
      return 'failed'
    }

    // Create order in Picqer
    const picqerOrder = await createOrder(mapResult.payload)

    // Process order (concept → processing)
    const processedOrder = await processOrder(picqerOrder.idorder)

    // Set custom orderfields (Leverdag + Levertijd) via separate PUT
    if (mapResult.payload.orderfields?.length) {
      await updateOrderFields(processedOrder.idorder, mapResult.payload.orderfields)
    }

    // Add "Floriday" tag
    const tagId = await getFloridayTagId()
    if (tagId) {
      await addOrderTag(processedOrder.idorder, tagId)
    }

    // Update mapping
    await upsertOrderMapping(salesOrder, {
      picqerOrderId: processedOrder.idorder,
      picqerOrderNumber: processedOrder.orderid,
      reference: mapResult.metadata?.reference,
      customerName: mapResult.metadata?.customerName,
      numLoadCarriers: mapResult.metadata?.numLoadCarriers,
      loadCarrierType: mapResult.metadata?.loadCarrierType,
    }, 'created')

    console.log(`Order ${salesOrderId} → Picqer ${processedOrder.orderid} | ref: "${mapResult.metadata?.reference || '-'}" | carriers: ${mapResult.metadata?.numLoadCarriers}x ${mapResult.metadata?.loadCarrierType || 'none'}`)
    return 'created'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error processing order ${salesOrderId}:`, message)
    await upsertOrderMapping(salesOrder, null, 'failed', message)
    return 'failed'
  }
}

// ─── Helpers ────────────────────────────────────────────────

function buildFulfillmentLookup(
  fulfillmentOrders: FloridayFulfillmentOrder[]
): Map<string, FloridayFulfillmentOrder> {
  const map = new Map<string, FloridayFulfillmentOrder>()

  for (const fo of fulfillmentOrders) {
    // Map each salesOrderId found in loadCarrierItems to this FO
    for (const lc of fo.loadCarriers || []) {
      for (const item of lc.loadCarrierItems || []) {
        if (item.salesOrderId && !map.has(item.salesOrderId)) {
          map.set(item.salesOrderId, fo)
        }
      }
    }
  }

  return map
}

async function upsertOrderMapping(
  salesOrder: FloridaySalesOrder,
  picqerData: {
    picqerOrderId: number
    picqerOrderNumber: string
    reference?: string
    customerName?: string
    numLoadCarriers?: number
    loadCarrierType?: string | null
  } | null,
  status: string,
  errorMessage?: string
): Promise<void> {
  const env = getFloridayEnv()
  const { error } = await supabase
    .schema('floriday')
    .from('order_mapping')
    .upsert(
      {
        floriday_sales_order_id: salesOrder.salesOrderId,
        environment: env,
        floriday_sales_channel: salesOrder.salesChannel,
        floriday_status: salesOrder.status,
        floriday_sequence_number: salesOrder.sequenceNumber,
        floriday_trade_item_id: salesOrder.tradeItemId,
        floriday_number_of_pieces: salesOrder.numberOfPieces,
        floriday_price_per_piece: salesOrder.pricePerPiece?.value || 0,
        floriday_customer_org_id: salesOrder.customerOrganizationId,
        floriday_delivery_date: salesOrder.delivery?.latestDeliveryDateTime || null,
        floriday_order_date: salesOrder.orderDateTime,
        trade_instrument: salesOrder.salesChannel,
        load_carrier_type: picqerData?.loadCarrierType || salesOrder.packingConfiguration?.loadCarrier?.loadCarrierType || null,
        num_load_carriers: picqerData?.numLoadCarriers || null,
        reference: picqerData?.reference || null,
        customer_name: picqerData?.customerName || null,
        picqer_order_id: picqerData?.picqerOrderId || null,
        picqer_order_number: picqerData?.picqerOrderNumber || null,
        processing_status: status,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_sales_order_id,environment' }
    )

  if (error) {
    console.error('Error upserting order mapping:', error)
  }
}

async function logSync(
  resource: string,
  action: string,
  status: string,
  details: Record<string, unknown>,
  durationMs?: number
): Promise<void> {
  const env = getFloridayEnv()
  await supabase
    .schema('floriday')
    .from('sync_log')
    .insert({
      service: 'floriday',
      environment: env,
      action,
      source_system: 'floriday',
      target_system: 'picqer',
      status,
      duration_ms: durationMs || null,
      payload: details,
    })
}
