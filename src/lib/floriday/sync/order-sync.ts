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
import { createOrder, processOrder, cancelOrder, addOrderTag, addComment, getTags, updateOrderFields } from '@/lib/picqer/client'
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
 * Check of order sync actief is. Uit te zetten via FLORIDAY_ORDER_SYNC_DISABLED=true.
 */
export function isOrderSyncDisabled(): boolean {
  return process.env.FLORIDAY_ORDER_SYNC_DISABLED === 'true'
}

/**
 * Sync all new fulfillment orders from Floriday and create them in Picqer.
 * Each FulfillmentOrder becomes 1 Picqer order.
 */
export async function syncOrders(): Promise<SyncResult> {
  if (isOrderSyncDisabled()) {
    console.log('Floriday order sync is uitgeschakeld (FLORIDAY_ORDER_SYNC_DISABLED=true)')
    return { success: true, ordersProcessed: 0, ordersCreated: 0, ordersFailed: 0, ordersSkipped: 0, errors: [], duration_ms: 0 }
  }

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
  let lockAcquired = false

  try {
    // Check if already processed
    const { data: existing } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('processing_status')
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)
      .single()

    if (existing && (existing.processing_status === 'created' || existing.processing_status === 'concept_unresolved')) {
      console.log(`FO ${foId} already processed (${existing.processing_status}), skipping`)
      return 'skipped'
    }

    // Only process ACCEPTED fulfillment orders
    if (fulfillmentOrder.status !== 'ACCEPTED') {
      await upsertOrderMapping(fulfillmentOrder, [], null, 'skipped', `FO status is ${fulfillmentOrder.status}`)
      return 'skipped'
    }

    // ── Acquire processing lock (prevents webhook + cron from creating duplicate Picqer orders)
    const { error: lockError } = await supabase
      .schema('floriday')
      .from('order_processing_lock')
      .insert({ fulfillment_order_id: foId, environment: env })

    if (lockError) {
      if (lockError.code === '23505') {
        // Lock held by another process — check if stale (> 5 min)
        const { data: lock } = await supabase
          .schema('floriday')
          .from('order_processing_lock')
          .select('claimed_at')
          .eq('fulfillment_order_id', foId)
          .eq('environment', env)
          .single()

        if (lock) {
          const lockAgeMs = Date.now() - new Date(lock.claimed_at).getTime()
          if (lockAgeMs > 5 * 60 * 1000) {
            console.log(`FO ${foId} stale lock (${Math.round(lockAgeMs / 1000)}s old), cleaning up for next cycle`)
            await supabase
              .schema('floriday')
              .from('order_processing_lock')
              .delete()
              .eq('fulfillment_order_id', foId)
              .eq('environment', env)
          } else {
            console.log(`FO ${foId} locked by another process (${Math.round(lockAgeMs / 1000)}s ago), skipping`)
          }
        }
        return 'skipped'
      }
      // Non-constraint error — log but continue without lock (graceful degradation)
      console.warn(`Lock acquisition failed for FO ${foId}:`, lockError.message)
    } else {
      lockAcquired = true
    }

    // ── Process with lock held ──

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
    const hasUnresolved = (mapResult.metadata?.unresolvedProducts?.length ?? 0) > 0

    let finalOrder = picqerOrder
    if (hasUnresolved) {
      // Keep order in concept — Dylan will manually fix the product + alt SKU
      console.log(`FO ${foId}: ${mapResult.metadata!.unresolvedProducts.length} onbekend(e) product(en), order blijft in concept`)
    } else {
      // Process order (concept → processing)
      finalOrder = await processOrder(picqerOrder.idorder)
    }

    // Set custom orderfields (Leverdag + Levertijd) via separate PUT
    if (mapResult.payload.orderfields?.length) {
      await updateOrderFields(finalOrder.idorder, mapResult.payload.orderfields)
    }

    // Add "Floriday" tag
    const tagId = await getFloridayTagId()
    if (tagId) {
      await addOrderTag(finalOrder.idorder, tagId)
    }

    // Add identification comment
    try {
      let commentBody = 'Bespoke Automation Floriday koppeling'
      if (hasUnresolved) {
        const missing = mapResult.metadata!.unresolvedProducts
          .map(p => `• "${p.supplierArticleCode}" (${p.tradeItemName})`)
          .join('\n')
        commentBody += `\n\n⚠️ LET OP: Dit order bevat onbekende producten (als "Onbekend Product" toegevoegd). Vul de alternatieve SKU in bij het product in Picqer en vervang het placeholder product in dit order:\n${missing}`
      }
      await addComment('orders', finalOrder.idorder, commentBody)
    } catch (commentErr) {
      console.warn(`Kon geen comment plaatsen op order ${finalOrder.orderid}:`, commentErr)
    }

    // Update mapping
    const status = hasUnresolved ? 'concept_unresolved' : 'created'
    await upsertOrderMapping(fulfillmentOrder, salesOrders, {
      picqerOrderId: finalOrder.idorder,
      picqerOrderNumber: finalOrder.orderid,
      reference: mapResult.metadata?.reference,
      customerName: mapResult.metadata?.customerName,
      numLoadCarriers: mapResult.metadata?.numLoadCarriers,
      loadCarrierType: mapResult.metadata?.loadCarrierType,
      numPlates: mapResult.metadata?.numPlates,
    }, status, hasUnresolved ? `Onbekende producten: ${mapResult.metadata!.unresolvedProducts.map(p => p.supplierArticleCode).join(', ')}` : undefined)

    console.log(`FO ${foId} → Picqer ${finalOrder.orderid} | ${salesOrders.length} SOs | ref: "${mapResult.metadata?.reference || '-'}" | carriers: ${mapResult.metadata?.numLoadCarriers}x ${mapResult.metadata?.loadCarrierType || 'none'} | platen: ${mapResult.metadata?.numPlates}${hasUnresolved ? ' | ⚠️ CONCEPT (onbekende producten)' : ''}`)
    return 'created'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error processing FO ${foId}:`, message)
    await upsertOrderMapping(fulfillmentOrder, [], null, 'failed', message)
    return 'failed'
  } finally {
    // Always release lock
    if (lockAcquired) {
      await supabase
        .schema('floriday')
        .from('order_processing_lock')
        .delete()
        .eq('fulfillment_order_id', foId)
        .eq('environment', env)
    }
  }
}

// ─── Handle CORRECTED FulfillmentOrder ─────────────────────

/**
 * Handle a CORRECTED FulfillmentOrder.
 * Strategy: cancel old Picqer order → create new one from corrected FO data.
 */
export async function handleCorrectedFO(
  fulfillmentOrder: FloridayFulfillmentOrder
): Promise<'corrected' | 'skipped' | 'failed'> {
  const env = getFloridayEnv()
  const foId = fulfillmentOrder.fulfillmentOrderId

  try {
    // Find existing mapping
    const { data: existing } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('picqer_order_id, picqer_order_number, processing_status')
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)
      .single()

    if (!existing || !existing.picqer_order_id) {
      console.log(`FO ${foId} CORRECTED maar geen bestaande Picqer order gevonden, behandel als nieuwe order`)
      // Treat as new — the FO might not have been processed yet
      return await processFulfillmentOrder(fulfillmentOrder) === 'created' ? 'corrected' : 'failed'
    }

    // Cancel old Picqer order
    console.log(`FO ${foId} CORRECTED → annuleer Picqer order ${existing.picqer_order_number}`)
    let cancelFailed = false
    try {
      await cancelOrder(existing.picqer_order_id)
    } catch (cancelErr) {
      cancelFailed = true
      const msg = cancelErr instanceof Error ? cancelErr.message : 'Unknown'
      console.warn(`Kon Picqer order ${existing.picqer_order_number} niet annuleren: ${msg}`)
      // Continue anyway — order might already be completed/cancelled
    }

    // Add comment to old Picqer order
    try {
      const commentBody = cancelFailed
        ? `⚠️ FLORIDAY CORRECTIE: Dit order is gecorrigeerd in Floriday (FO ${foId}). Annuleren is mislukt — controleer handmatig. Er wordt een nieuw order aangemaakt met de gecorrigeerde data.`
        : `FLORIDAY CORRECTIE: Dit order is geannuleerd vanwege een correctie in Floriday (FO ${foId}). Er wordt een nieuw order aangemaakt met de gecorrigeerde data.`
      await addComment('orders', existing.picqer_order_id, commentBody)
    } catch (commentErr) {
      console.warn(`Kon geen comment plaatsen op order ${existing.picqer_order_number}:`, commentErr)
    }

    // Mark old mapping as cancelled
    await supabase
      .schema('floriday')
      .from('order_mapping')
      .update({
        processing_status: 'cancelled_for_correction',
        error_message: `Gecorrigeerd → oud order ${existing.picqer_order_number} geannuleerd`,
        updated_at: new Date().toISOString(),
      })
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)

    // Delete mapping so processFulfillmentOrder creates a new one
    await supabase
      .schema('floriday')
      .from('order_mapping')
      .delete()
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)

    // Create new Picqer order from corrected FO
    const result = await processFulfillmentOrder(fulfillmentOrder)

    if (result === 'created') {
      console.log(`FO ${foId} CORRECTED → nieuw Picqer order aangemaakt (vervangt ${existing.picqer_order_number})`)
      return 'corrected'
    }

    return 'failed'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error handling CORRECTED FO ${foId}:`, message)
    await upsertOrderMapping(fulfillmentOrder, [], null, 'failed', `CORRECTED handling failed: ${message}`)
    return 'failed'
  }
}

// ─── Handle CANCELLED FulfillmentOrder ─────────────────────

/**
 * Handle a CANCELLED FulfillmentOrder.
 * Cancel the corresponding Picqer order if it exists.
 */
export async function handleCancelledFO(
  fulfillmentOrder: FloridayFulfillmentOrder
): Promise<'cancelled' | 'skipped' | 'failed'> {
  const env = getFloridayEnv()
  const foId = fulfillmentOrder.fulfillmentOrderId

  try {
    // Find existing mapping
    const { data: existing } = await supabase
      .schema('floriday')
      .from('order_mapping')
      .select('picqer_order_id, picqer_order_number, processing_status')
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)
      .single()

    if (!existing || !existing.picqer_order_id) {
      console.log(`FO ${foId} CANCELLED maar geen bestaande Picqer order gevonden`)
      await upsertOrderMapping(fulfillmentOrder, [], null, 'cancelled', 'FO geannuleerd (geen Picqer order)')
      return 'skipped'
    }

    if (existing.processing_status === 'cancelled') {
      console.log(`FO ${foId} already cancelled, skipping`)
      return 'skipped'
    }

    // Cancel Picqer order
    console.log(`FO ${foId} CANCELLED → annuleer Picqer order ${existing.picqer_order_number}`)
    let cancelFailed = false
    try {
      await cancelOrder(existing.picqer_order_id)
    } catch (cancelErr) {
      cancelFailed = true
      const msg = cancelErr instanceof Error ? cancelErr.message : 'Unknown'
      console.warn(`Kon Picqer order ${existing.picqer_order_number} niet annuleren: ${msg}`)
      // Order might already be shipped/completed — log the error but don't fail
    }

    // Add comment to Picqer order
    try {
      const commentBody = cancelFailed
        ? `⚠️ FLORIDAY ANNULERING: Dit order is geannuleerd in Floriday (FO ${foId}). Automatisch annuleren is mislukt — controleer handmatig.`
        : `FLORIDAY ANNULERING: Dit order is geannuleerd in Floriday (FO ${foId}).`
      await addComment('orders', existing.picqer_order_id, commentBody)
    } catch (commentErr) {
      console.warn(`Kon geen comment plaatsen op order ${existing.picqer_order_number}:`, commentErr)
    }

    // Update mapping
    await supabase
      .schema('floriday')
      .from('order_mapping')
      .update({
        processing_status: 'cancelled',
        floriday_status: 'CANCELLED',
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('floriday_fulfillment_order_id', foId)
      .eq('environment', env)

    console.log(`FO ${foId} → Picqer order ${existing.picqer_order_number} geannuleerd`)
    return 'cancelled'
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error handling CANCELLED FO ${foId}:`, message)
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
