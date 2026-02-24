// ══════════════════════════════════════════════════════════════
// Order Sync: Floriday FulfillmentOrders → Picqer Orders
// ══════════════════════════════════════════════════════════════
//
// Orchestrator die:
// 1. Warehouse cache ververst (voor afleveradres resolutie)
// 2. Fulfillment orders synct via sequence-based polling
// 3. Per FO: linked sales orders ophaalt, mapt, en 1 Picqer order aanmaakt
// 4. Resultaten logt in floriday.order_mapping en floriday.sync_log
//
// Kernconcept: 1 FulfillmentOrder = 1 Picqer Order
// (meerdere Floriday sales orders worden gecombineerd)

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import {
  syncAll,
  getFulfillmentOrder,
  getSalesOrder,
  getWarehouses,
} from '@/lib/floriday/client'
import { createOrder, processOrder, addOrderTag, getTags, updateOrderFields } from '@/lib/picqer/client'
import { mapFulfillmentOrderToPicqer } from '@/lib/floriday/mappers/order-mapper'
import type { FloridaySalesOrder, FloridayFulfillmentOrder } from '@/lib/floriday/types'

// ─── Types ──────────────────────────────────────────────────

export interface SyncResult {
  success: boolean
  ordersProcessed: number
  ordersCreated: number
  ordersFailed: number
  ordersSkipped: number
  errors: Array<{ fulfillmentOrderId: string; error: string }>
  duration_ms: number
}

// ─── Warehouse Cache ────────────────────────────────────────

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
 * Sync all new fulfillment orders from Floriday and create them in Picqer.
 * Each FulfillmentOrder becomes 1 Picqer order.
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

    // 2. Get current sequence for fulfillment orders
    const { data: syncState } = await supabase
      .schema('floriday')
      .from('sync_state')
      .select('last_processed_sequence')
      .eq('resource_name', 'fulfillment-orders')
      .eq('environment', env)
      .single()

    const fromSequence = syncState?.last_processed_sequence || 0

    // 3. Sync fulfillment orders
    await syncAll<FloridayFulfillmentOrder>(
      'fulfillment-orders',
      fromSequence,
      async (results, maxSeq) => {
        for (const fo of results) {
          ordersProcessed++

          const result = await processFulfillmentOrder(fo)

          if (result === 'created') ordersCreated++
          else if (result === 'skipped') ordersSkipped++
          else if (result === 'failed') {
            ordersFailed++
            errors.push({ fulfillmentOrderId: fo.fulfillmentOrderId, error: 'See order_mapping' })
          }
        }

        // Update sequence
        await supabase
          .schema('floriday')
          .from('sync_state')
          .upsert(
            {
              resource_name: 'fulfillment-orders',
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

    // 4. Log sync result
    await logSync('fulfillment-orders', 'sync', 'success', {
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

    await logSync('fulfillment-orders', 'sync', 'error', { error: message }, duration_ms)

    return {
      success: false,
      ordersProcessed,
      ordersCreated,
      ordersFailed,
      ordersSkipped,
      errors: [{ fulfillmentOrderId: 'sync', error: message }],
      duration_ms,
    }
  }
}

// ─── Process Single FulfillmentOrder ────────────────────────

/**
 * Process a single Floriday FulfillmentOrder into a Picqer order.
 * Fetches all linked sales orders, maps them, creates 1 Picqer order.
 */
export async function processFulfillmentOrder(
  fulfillmentOrder: FloridayFulfillmentOrder
): Promise<'created' | 'skipped' | 'failed'> {
  const env = getFloridayEnv()
  const foId = fulfillmentOrder.fulfillmentOrderId

  try {
    // Check if already processed
    const { data: existing } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('processing_status')
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)
      .single()

    if (existing && existing.processing_status === 'created') {
      console.log(`FO ${foId} already created, skipping`)
      return 'skipped'
    }

    // Only process ACCEPTED fulfillment orders
    if (fulfillmentOrder.status !== 'ACCEPTED') {
      await upsertOrderMapping(fulfillmentOrder, [], null, 'skipped', `FO status is ${fulfillmentOrder.status}`)
      return 'skipped'
    }

    // Extract all salesOrderIds from loadCarrierItems
    const salesOrderIds = new Set<string>()
    for (const lc of fulfillmentOrder.loadCarriers || []) {
      for (const item of lc.loadCarrierItems || []) {
        if (item.salesOrderId) {
          salesOrderIds.add(item.salesOrderId)
        }
      }
    }

    if (salesOrderIds.size === 0) {
      await upsertOrderMapping(fulfillmentOrder, [], null, 'skipped', 'No sales orders in FO')
      return 'skipped'
    }

    // Fetch all linked sales orders
    const salesOrders: FloridaySalesOrder[] = []
    for (const soId of salesOrderIds) {
      const so = await getSalesOrder(soId)
      salesOrders.push(so)
    }

    // Check that all sales orders are COMMITTED
    const uncommitted = salesOrders.filter(so => so.status !== 'COMMITTED')
    if (uncommitted.length > 0) {
      const statuses = uncommitted.map(so => `${so.salesOrderId}: ${so.status}`).join(', ')
      await upsertOrderMapping(fulfillmentOrder, salesOrders, null, 'skipped', `Not all SOs committed: ${statuses}`)
      return 'skipped'
    }

    // Map to Picqer
    const mapResult = await mapFulfillmentOrderToPicqer(fulfillmentOrder, salesOrders)

    if (!mapResult.success || !mapResult.payload) {
      await upsertOrderMapping(fulfillmentOrder, salesOrders, null, 'failed', mapResult.error || 'Mapping failed')
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
    await upsertOrderMapping(fulfillmentOrder, salesOrders, {
      picqerOrderId: processedOrder.idorder,
      picqerOrderNumber: processedOrder.orderid,
      reference: mapResult.metadata?.reference,
      customerName: mapResult.metadata?.customerName,
      numLoadCarriers: mapResult.metadata?.numLoadCarriers,
      loadCarrierType: mapResult.metadata?.loadCarrierType,
      numPlates: mapResult.metadata?.numPlates,
    }, 'created')

    console.log(`FO ${foId} → Picqer ${processedOrder.orderid} | ${salesOrders.length} SOs | ref: "${mapResult.metadata?.reference || '-'}" | carriers: ${mapResult.metadata?.numLoadCarriers}x ${mapResult.metadata?.loadCarrierType || 'none'} | platen: ${mapResult.metadata?.numPlates}`)
    return 'created'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error processing FO ${foId}:`, message)
    await upsertOrderMapping(fulfillmentOrder, [], null, 'failed', message)
    return 'failed'
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function upsertOrderMapping(
  fo: FloridayFulfillmentOrder,
  salesOrders: FloridaySalesOrder[],
  picqerData: {
    picqerOrderId: number
    picqerOrderNumber: string
    reference?: string
    customerName?: string
    numLoadCarriers?: number
    loadCarrierType?: string | null
    numPlates?: number
  } | null,
  status: string,
  errorMessage?: string
): Promise<void> {
  const env = getFloridayEnv()
  const firstSO = salesOrders[0]

  const { error } = await supabase
    .schema('floriday')
    .from('order_mapping')
    .upsert(
      {
        floriday_fulfillment_order_id: fo.fulfillmentOrderId,
        environment: env,
        floriday_sales_order_ids: salesOrders.map(so => so.salesOrderId),
        floriday_status: fo.status,
        floriday_sequence_number: fo.sequenceNumber,
        floriday_customer_org_id: firstSO?.customerOrganizationId || null,
        floriday_delivery_date: fo.latestDeliveryDateTime || null,
        floriday_order_date: fo.creationDateTime,
        num_sales_orders: salesOrders.length,
        load_carrier_type: picqerData?.loadCarrierType || null,
        num_load_carriers: picqerData?.numLoadCarriers || (fo.loadCarriers || []).length,
        num_plates: picqerData?.numPlates || 0,
        reference: picqerData?.reference || null,
        customer_name: picqerData?.customerName || null,
        picqer_order_id: picqerData?.picqerOrderId || null,
        picqer_order_number: picqerData?.picqerOrderNumber || null,
        processing_status: status,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_fulfillment_order_id,environment' }
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
