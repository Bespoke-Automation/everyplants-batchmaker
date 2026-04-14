import { inngest } from '@/inngest/client'
import { fetchOrder, fetchPicklist, getPicklistShipments } from '@/lib/picqer/client'
import { getRetailerByTagId } from '@/lib/picqer/transform'
import { ORDERFIELD_IDS, type PicqerShipment } from '@/lib/picqer/types'
import {
  resolveStoreForRetailer,
  getOrder as getShopifyOrder,
  getFulfillmentOrders,
  extractPicqerLocationId,
  updateFulfillmentTracking,
  ShopifyConfigError,
  ShopifyApiError,
  type ShopifyFulfillment,
} from '@/lib/shopify/admin-client'
import { supabase } from '@/lib/supabase/client'

/**
 * Hard allowlist of retailer tag IDs (NOT names) that are permitted to push to
 * Shopify. We use IDs because Picqer tag IDs are immutable while names can be
 * edited; matching on a renamed tag could otherwise let an unintended retailer
 * slip through.
 *
 * Even if the DB config table has more stores marked enabled, we will never
 * push tracking codes for retailers whose tag IDs are not in this map.
 *
 * Adding a new retailer requires:
 *   1) verified Picqer tag id
 *   2) verified credentials in env vars
 *   3) successful staging test
 *   4) explicit sign-off from operations
 *
 * Currently active: Florafy (tag id 252017) only.
 */
const ALLOWED_RETAILER_TAG_IDS: Record<string, number> = {
  Florafy: 252017,
}

/**
 * Patches a Picqer Shopify sync limitation: Picqer pushes only the first shipment
 * per picklist to Shopify as a fulfillment tracking code. For picklists with >1
 * shipment (e.g. plant + pot in separate boxes), the second+ tracking codes never
 * reach the customer and they think products are missing.
 *
 * The function fetches all shipments from Picqer, finds the matching Shopify
 * fulfillment by cross-referencing the existing tracking code, and merges the
 * full set of Picqer trackings into that fulfillment via the GraphQL Admin API.
 *
 * Strategy is MERGE not REPLACE — we union existing Shopify trackings with the
 * Picqer set so we never wipe out trackings added by other systems (support
 * agents, other picklists on the same order, etc.).
 *
 * Debounce on picklist id collapses parallel ship-call events into one run.
 */
export const syncShopifyTracking = inngest.createFunction(
  {
    id: 'sync-shopify-tracking',
    name: 'Sync Shopify tracking codes (multi-shipment patch)',
    debounce: { key: 'event.data.picqerPicklistId', period: '15s' },
    // Retries must cover the window during which Picqer's own Shopify sync pushes
    // the initial fulfillment. Observed in production on 2026-04-14: Picqer can
    // take 15-30+ minutes after shipments are created before the fulfillment is
    // visible in Shopify. With Inngest's default exponential backoff, 10 retries
    // give a total window of ~8 hours — more than enough margin without losing
    // events on first-attempt races.
    retries: 10,
  },
  { event: 'shopify/tracking.sync' },
  async ({ event, step, logger }) => {
    const { picqerPicklistId, triggeredBy, notifyCustomer: notifyOverride } = event.data as {
      picqerPicklistId: number
      triggeredBy?: string
      notifyCustomer?: boolean
    }
    const shouldNotify = notifyOverride !== undefined ? notifyOverride : true

    if (!picqerPicklistId || typeof picqerPicklistId !== 'number') {
      logger.error(`[shopify-sync] invalid picklist id in event: ${picqerPicklistId}`)
      return { status: 'failed', reason: 'invalid_picklist_id' }
    }

    if (process.env.SHOPIFY_TRACKING_SYNC_ENABLED !== 'true') {
      logger.info(`[shopify-sync] kill switch on, skipping picklist ${picqerPicklistId}`)
      return { status: 'skipped', reason: 'kill_switch_off' }
    }

    // Wait 3 minutes before first check so Picqer's own Shopify sync has time to
    // push the initial fulfillment. Without this, the first attempt almost always
    // races the Picqer → Shopify push and we'd burn retries. step.sleep is a
    // durable pause — it doesn't count against function execution time.
    // Skipped for backfill triggers because those orders are already shipped long ago.
    const isBackfill = triggeredBy?.startsWith('backfill') === true
    if (!isBackfill) {
      await step.sleep('wait-for-picqer-shopify-sync', '3m')
    }

    // Step 1: Resolve picklist → order → shipments
    const picqerData = await step.run('fetch-picqer-data', async () => {
      const picklist = await fetchPicklist(picqerPicklistId)
      const order = await fetchOrder(picklist.idorder)
      const shipments = await getPicklistShipments(picqerPicklistId)
      return { order, shipments, picqerOrderId: picklist.idorder }
    })

    const { order, shipments, picqerOrderId } = picqerData

    // Hardlock by tag id: tag IDs are immutable in Picqer, names are not.
    // We will never patch Shopify for an order whose retailer tag id is not in
    // ALLOWED_RETAILER_TAG_IDS — even if a store is enabled in the DB.
    const retailerMatch = getRetailerByTagId(order, ALLOWED_RETAILER_TAG_IDS)
    if (!retailerMatch) {
      const presentTagIds = Object.values(order.tags ?? {}).map(t => t.idtag)
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: 'unknown',
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        status: 'skipped',
        skip_reason: `no_allowed_retailer_tag_id_present:[${presentTagIds.join(',')}]`,
      })
      return { status: 'skipped', reason: 'retailer_not_allowed' }
    }
    const retailerTag = retailerMatch.retailerTag

    // Build the canonical (tracking, url) pairs we want on Shopify.
    // - Filter cancelled shipments
    // - Filter shipments without a tracking code
    // - Trim whitespace
    // - Dedupe by tracking code (defensive against Picqer returning the same shipment twice)
    const picqerPairs = dedupePairs(buildTrackingPairs(shipments))

    if (picqerPairs.length < 2) {
      // Picqer's normal sync handles single-shipment cases correctly. Nothing to patch.
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: `only_${picqerPairs.length}_valid_shipment`,
      })
      return { status: 'skipped', reason: 'single_shipment' }
    }

    // All shipments must share one carrier — Shopify's fulfillment tracking_info
    // requires a single `company` value per fulfillment. Mixed carriers cannot
    // be merged into one fulfillment without losing the carrier-specific tracking URL
    // routing. Logged so we can revisit if it occurs in production.
    const carriers = new Set(
      shipments
        .filter(s => !s.cancelled && s.trackingcode)
        .map(s => (s.public_providername || s.providername || '').trim())
        .filter(Boolean),
    )
    if (carriers.size > 1) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: `mixed_carriers:${Array.from(carriers).join(',')}`,
      })
      return { status: 'skipped', reason: 'mixed_carriers', carriers: Array.from(carriers) }
    }

    // Step 2: Resolve store config + credentials
    const store = await step.run('resolve-store', async () => {
      try {
        return await resolveStoreForRetailer(retailerTag)
      } catch (e) {
        if (e instanceof ShopifyConfigError) {
          logger.warn(`[shopify-sync] config error for ${retailerTag}: ${e.message}`)
          return null
        }
        throw e
      }
    })

    if (!store) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: 'store_not_configured_or_disabled',
      })
      return { status: 'skipped', reason: 'store_disabled_or_missing' }
    }

    // Defense in depth: cross-check that the resolved store actually targets the
    // retailer we intended. Guards against a misconfigured DB row.
    if (store.config.retailer_tag !== retailerTag) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        status: 'failed',
        error: `store config mismatch: expected ${retailerTag}, got ${store.config.retailer_tag}`,
      })
      return { status: 'failed', reason: 'store_config_mismatch' }
    }

    // Step 3: Find the Shopify order
    const shopifyOrderIdStr = (order.orderfields ?? [])
      .find(f => f.idorderfield === ORDERFIELD_IDS.RETAILER_ORDER_NUMBER)
      ?.value?.trim()
    if (!shopifyOrderIdStr || !/^\d+$/.test(shopifyOrderIdStr)) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        status: 'skipped',
        skip_reason: shopifyOrderIdStr ? `invalid_retailer_order_number:${shopifyOrderIdStr}` : 'no_retailer_order_number',
      })
      return { status: 'skipped', reason: 'missing_or_invalid_retailer_order_number' }
    }
    const shopifyOrderId = Number(shopifyOrderIdStr)

    const { shopifyOrder, picqerLocationId } = await step.run('fetch-shopify-order', async () => {
      const order = await getShopifyOrder(store, shopifyOrderId)
      if (!order) return { shopifyOrder: null, picqerLocationId: null }
      // Concurrently fetch fulfillment_orders so we know which location is Picqer's
      const fulfillmentOrders = await getFulfillmentOrders(store, shopifyOrderId)
      const locId = extractPicqerLocationId(fulfillmentOrders)
      return { shopifyOrder: order, picqerLocationId: locId }
    })

    if (!shopifyOrder) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        shopify_order_id: shopifyOrderId,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        status: 'failed',
        error: `Shopify order ${shopifyOrderId} not found`,
      })
      return { status: 'failed', reason: 'shopify_order_not_found' }
    }

    // Gate: refuse to touch orders that are not routed through Picqer's fulfilment
    // service. This prevents us from accidentally patching fulfillments that
    // belong to Everspring (or any other) fulfilment service on the same order.
    if (!picqerLocationId) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        shopify_order_id: shopifyOrderId,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: 'no_picqer_fulfilment_location',
      })
      return { status: 'skipped', reason: 'order_not_at_picqer_location' }
    }

    // Step 4: Find the right fulfillment to patch.
    // Strategy: find a fulfillment that (a) lives at the Picqer location AND (b)
    // contains at least one of our picklist's trackings. This handles multi-picklist
    // and mixed-fulfilment-service orders correctly — we never cross-patch.
    const fulfillment = findMatchingFulfillment(
      shopifyOrder.fulfillments ?? [],
      picqerPairs.map(p => p.number),
      picqerLocationId,
    )

    if (!fulfillment) {
      // Two cases land here, both mean "we cannot safely patch":
      //  1) zero fulfillments at the Picqer location (Picqer sync hasn't pushed yet)
      //  2) multiple fulfillments at the Picqer location and none contain our trackings
      // Both are retryable — case 1 is a race we want to win on retry.
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        shopify_order_id: shopifyOrderId,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: 'no_matching_picqer_fulfillment_yet',
      })
      throw new Error(
        `No Picqer-location fulfillment on Shopify order ${shopifyOrderId} contains our trackings — Picqer sync may still be in progress`,
      )
    }

    if (fulfillment.status && fulfillment.status !== 'success') {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        shopify_order_id: shopifyOrderId,
        shopify_fulfillment_id: fulfillment.id,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: picqerPairs.map(p => p.number),
        status: 'skipped',
        skip_reason: `fulfillment_status_${fulfillment.status}`,
      })
      return { status: 'skipped', reason: 'fulfillment_not_success', fulfillmentStatus: fulfillment.status }
    }

    // Build the merged tracking set: existing Shopify trackings ∪ Picqer trackings.
    // Pair preservation: existing pairs (keep their URL), then new pairs from Picqer.
    const merged = mergeTrackingPairs(
      pairsFromShopifyFulfillment(fulfillment),
      picqerPairs,
    )

    // Idempotency: if the merged set equals what's already on Shopify, skip.
    const existingNumbers = (fulfillment.tracking_numbers ?? []).map(n => n.trim()).filter(Boolean)
    const noChange =
      merged.length === existingNumbers.length &&
      merged.every(p => existingNumbers.includes(p.number))

    const carrier =
      store.config.carrier_override ||
      fulfillment.tracking_company ||
      shipments.find(s => !s.cancelled && s.trackingcode)?.public_providername ||
      shipments.find(s => !s.cancelled && s.trackingcode)?.providername ||
      'Other'

    if (noChange) {
      await logSync({
        picqer_order_id: picqerOrderId,
        picqer_picklist_id: picqerPicklistId,
        retailer_tag: retailerTag,
        shopify_order_id: shopifyOrderId,
        shopify_fulfillment_id: fulfillment.id,
        picqer_shipment_ids: shipments.map(s => s.idshipment),
        tracking_codes: merged.map(p => p.number),
        carrier,
        status: 'skipped',
        skip_reason: 'already_in_sync',
      })
      return { status: 'skipped', reason: 'already_in_sync' }
    }

    await step.run('update-shopify-tracking', async () => {
      try {
        return await updateFulfillmentTracking(
          store,
          fulfillment.id,
          {
            company: carrier,
            numbers: merged.map(p => p.number),
            urls: merged.map(p => p.url),
          },
          shouldNotify,
        )
      } catch (e) {
        // Wrap and rethrow so Inngest retries see the original
        if (e instanceof ShopifyApiError) {
          logger.error(
            `[shopify-sync] Shopify API error patching fulfillment ${fulfillment.id}: ${e.message} body=${e.body}`,
          )
        }
        throw e
      }
    })

    await logSync({
      picqer_order_id: picqerOrderId,
      picqer_picklist_id: picqerPicklistId,
      retailer_tag: retailerTag,
      shopify_order_id: shopifyOrderId,
      shopify_fulfillment_id: fulfillment.id,
      picqer_shipment_ids: shipments.map(s => s.idshipment),
      tracking_codes: merged.map(p => p.number),
      tracking_urls: merged.map(p => p.url),
      carrier,
      status: 'synced',
      synced_at: new Date().toISOString(),
    })

    logger.info(
      `[shopify-sync] patched fulfillment ${fulfillment.id} on ${retailerTag} order ${shopifyOrderId} with ${merged.length} trackings (was ${existingNumbers.length}, triggered by ${triggeredBy ?? 'unknown'})`,
    )

    return {
      status: 'synced',
      shopifyOrderId,
      fulfillmentId: fulfillment.id,
      trackingCount: merged.length,
      previousTrackingCount: existingNumbers.length,
    }
  },
)

// ── Helpers ─────────────────────────────────────────────────────────────────

interface TrackingPair {
  number: string
  url: string
}

function buildTrackingPairs(shipments: PicqerShipment[]): TrackingPair[] {
  const pairs: TrackingPair[] = []
  for (const s of shipments) {
    if (s.cancelled) continue
    const number = s.trackingcode?.trim()
    if (!number) continue
    const url = (s.trackingurl || s.tracktraceurl || '').trim()
    pairs.push({ number, url })
  }
  return pairs
}

function dedupePairs(pairs: TrackingPair[]): TrackingPair[] {
  const seen = new Set<string>()
  const result: TrackingPair[] = []
  for (const p of pairs) {
    if (seen.has(p.number)) continue
    seen.add(p.number)
    result.push(p)
  }
  return result
}

function pairsFromShopifyFulfillment(fulfillment: ShopifyFulfillment): TrackingPair[] {
  const numbers = fulfillment.tracking_numbers ?? []
  const urls = fulfillment.tracking_urls ?? []
  const pairs: TrackingPair[] = []
  for (let i = 0; i < numbers.length; i++) {
    const num = (numbers[i] || '').trim()
    if (!num) continue
    pairs.push({ number: num, url: (urls[i] || '').trim() })
  }
  return pairs
}

function mergeTrackingPairs(existing: TrackingPair[], picqer: TrackingPair[]): TrackingPair[] {
  const map = new Map<string, TrackingPair>()
  // Existing first so preserved order is stable
  for (const p of existing) map.set(p.number, p)
  // Picqer wins on URL collisions because Picqer is the authoritative source for our shipments
  for (const p of picqer) {
    const prior = map.get(p.number)
    if (prior) {
      map.set(p.number, { number: p.number, url: p.url || prior.url })
    } else {
      map.set(p.number, p)
    }
  }
  return Array.from(map.values())
}

function findMatchingFulfillment(
  fulfillments: ShopifyFulfillment[],
  picqerNumbers: string[],
  picqerLocationId: number,
): ShopifyFulfillment | null {
  if (fulfillments.length === 0) return null
  const targetSet = new Set(picqerNumbers)

  // Only fulfillments that live at the Picqer fulfilment location are eligible.
  // This is the hard guard against patching Everspring (or any other) fulfilments.
  const atPicqer = fulfillments.filter(f => f.location_id === picqerLocationId)
  if (atPicqer.length === 0) return null

  // Prefer the Picqer-location fulfillment that already contains any of our trackings
  for (const f of atPicqer) {
    const fNumbers = f.tracking_numbers ?? []
    if (fNumbers.some(n => targetSet.has(n.trim()))) {
      return f
    }
  }

  // Fallback: if there is exactly ONE active fulfillment AT THE PICQER LOCATION
  // (no ambiguity), we can patch it. Handles the race window before Picqer's own
  // sync pushed any tracking — but only when there is exactly one candidate.
  const active = atPicqer.filter(f => !f.status || f.status === 'success')
  if (active.length === 1) return active[0]

  return null
}

interface SyncLogRow {
  picqer_order_id: number
  picqer_picklist_id: number
  retailer_tag: string
  shopify_order_id?: number | null
  shopify_fulfillment_id?: number | null
  picqer_shipment_ids?: number[]
  tracking_codes?: string[]
  tracking_urls?: string[]
  carrier?: string | null
  status: 'pending' | 'synced' | 'skipped' | 'failed'
  skip_reason?: string
  error?: string
  synced_at?: string
}

async function logSync(row: SyncLogRow): Promise<void> {
  try {
    await supabase.schema('batchmaker').from('shopify_tracking_sync_log').insert(row)
  } catch (e) {
    // Logging must never break the sync flow
    console.error('[shopify-sync] failed to write sync log:', e)
  }
}

/**
 * Helper for the retroactive backfill script and on-demand retries from the dashboard.
 * Fires the event that the Inngest function listens to.
 */
export async function triggerShopifyTrackingSync(
  picqerPicklistId: number,
  triggeredBy: string,
  notifyCustomer?: boolean,
): Promise<void> {
  await inngest.send({
    name: 'shopify/tracking.sync',
    data: { picqerPicklistId, triggeredBy, ...(notifyCustomer !== undefined && { notifyCustomer }) },
  })
}

// Exported for unit testing without needing Inngest
export const __test = {
  buildTrackingPairs,
  dedupePairs,
  pairsFromShopifyFulfillment,
  mergeTrackingPairs,
  findMatchingFulfillment,
  ALLOWED_RETAILER_TAG_IDS,
}

export { ALLOWED_RETAILER_TAG_IDS }
