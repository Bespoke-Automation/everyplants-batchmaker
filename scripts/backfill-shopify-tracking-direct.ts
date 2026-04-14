/**
 * Direct backfill — bypasses Inngest and executes the Shopify tracking sync
 * logic synchronously for each candidate. More reliable for one-time backfills
 * than event-based approach (avoids Inngest debounce/rate-limit delays).
 *
 * Usage:
 *   npx tsx scripts/backfill-shopify-tracking-direct.ts --days 30 [--dry-run] [--no-notify]
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { fetchOrder, fetchPicklist, getPicklistShipments } from '../src/lib/picqer/client'
import { getRetailerTagFromOrder, getRetailerByTagId, RETAILER_TAG_IDS } from '../src/lib/picqer/transform'
import { ORDERFIELD_IDS, type PicqerShipment } from '../src/lib/picqer/types'
import { fetchOrdersByStatus } from '../src/lib/picqer/client'
import {
  resolveStoreForRetailer,
  getOrder as getShopifyOrder,
  getFulfillmentOrders,
  extractPicqerLocationId,
  updateFulfillmentTracking,
  type ResolvedStore,
} from '../src/lib/shopify/admin-client'
import { supabase } from '../src/lib/supabase/client'

const ALLOWED_TAG_IDS: Record<string, number> = { Florafy: 252017 }

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (f: string, d?: string) => { const i = args.indexOf(f); return i !== -1 && i + 1 < args.length ? args[i + 1] : d }
  return {
    days: Number(get('--days', '30')),
    dryRun: args.includes('--dry-run'),
    noNotify: args.includes('--no-notify'),
  }
}

interface TrackingPair { number: string; url: string }

function buildPairs(shipments: PicqerShipment[]): TrackingPair[] {
  const seen = new Set<string>()
  const pairs: TrackingPair[] = []
  for (const s of shipments) {
    if (s.cancelled) continue
    const num = s.trackingcode?.trim()
    if (!num || seen.has(num)) continue
    seen.add(num)
    pairs.push({ number: num, url: (s.trackingurl || s.tracktraceurl || '').trim() })
  }
  return pairs
}

async function logSync(row: Record<string, unknown>): Promise<void> {
  try {
    await supabase.schema('batchmaker').from('shopify_tracking_sync_log').insert(row)
  } catch { /* non-blocking */ }
}

async function processPicklist(
  picklistId: number,
  store: ResolvedStore,
  retailerTag: string,
  dryRun: boolean,
  notify: boolean,
): Promise<string> {
  const picklist = await fetchPicklist(picklistId)
  const order = await fetchOrder(picklist.idorder)
  const shipments = await getPicklistShipments(picklistId)
  const pairs = buildPairs(shipments)

  if (pairs.length < 2) return 'skipped:single_shipment'

  const carriers = new Set(shipments.filter(s => !s.cancelled && s.trackingcode).map(s => (s.public_providername || s.providername || '').trim()).filter(Boolean))
  if (carriers.size > 1) return `skipped:mixed_carriers:${[...carriers].join(',')}`

  const shopifyOrderIdStr = (order.orderfields ?? []).find(f => f.idorderfield === ORDERFIELD_IDS.RETAILER_ORDER_NUMBER)?.value?.trim()
  if (!shopifyOrderIdStr || !/^\d+$/.test(shopifyOrderIdStr)) return 'skipped:no_retailer_order_number'
  const shopifyOrderId = Number(shopifyOrderIdStr)

  const shopifyOrder = await getShopifyOrder(store, shopifyOrderId)
  if (!shopifyOrder) return 'failed:shopify_order_not_found'

  const fos = await getFulfillmentOrders(store, shopifyOrderId)
  const picqerLocId = extractPicqerLocationId(fos)
  if (!picqerLocId) return 'skipped:no_picqer_fulfilment_location'

  const atPicqer = (shopifyOrder.fulfillments ?? []).filter(f => f.location_id === picqerLocId)
  const targetSet = new Set(pairs.map(p => p.number))
  let fulfillment = atPicqer.find(f => (f.tracking_numbers ?? []).some(n => targetSet.has(n.trim())))
  if (!fulfillment) {
    const active = atPicqer.filter(f => !f.status || f.status === 'success')
    if (active.length === 1) fulfillment = active[0]
  }
  if (!fulfillment) return 'skipped:no_matching_fulfillment'
  if (fulfillment.status && fulfillment.status !== 'success') return `skipped:fulfillment_${fulfillment.status}`

  // Merge
  const merged = new Map<string, TrackingPair>()
  const existingNums = fulfillment.tracking_numbers ?? []
  const existingUrls = fulfillment.tracking_urls ?? []
  for (let i = 0; i < existingNums.length; i++) {
    const n = existingNums[i].trim()
    if (n) merged.set(n, { number: n, url: (existingUrls[i] || '').trim() })
  }
  for (const p of pairs) {
    const prior = merged.get(p.number)
    merged.set(p.number, { number: p.number, url: p.url || prior?.url || '' })
  }
  const mergedArr = [...merged.values()]

  const noChange = mergedArr.length === existingNums.length && mergedArr.every(p => existingNums.includes(p.number))
  if (noChange) {
    await logSync({
      picqer_order_id: picklist.idorder, picqer_picklist_id: picklistId,
      retailer_tag: retailerTag, shopify_order_id: shopifyOrderId,
      shopify_fulfillment_id: fulfillment.id,
      picqer_shipment_ids: shipments.map(s => s.idshipment),
      tracking_codes: mergedArr.map(p => p.number),
      status: 'skipped', skip_reason: 'already_in_sync',
    })
    return 'skipped:already_in_sync'
  }

  const carrier = fulfillment.tracking_company || shipments.find(s => !s.cancelled && s.trackingcode)?.public_providername || 'Other'

  if (dryRun) return `would_sync:${mergedArr.length}_trackings`

  const result = await updateFulfillmentTracking(store, fulfillment.id, {
    company: carrier,
    numbers: mergedArr.map(p => p.number),
    urls: mergedArr.map(p => p.url),
  }, notify)

  await logSync({
    picqer_order_id: picklist.idorder, picqer_picklist_id: picklistId,
    retailer_tag: retailerTag, shopify_order_id: shopifyOrderId,
    shopify_fulfillment_id: fulfillment.id,
    picqer_shipment_ids: shipments.map(s => s.idshipment),
    tracking_codes: mergedArr.map(p => p.number),
    tracking_urls: mergedArr.map(p => p.url),
    carrier, status: 'synced', synced_at: new Date().toISOString(),
  })

  return `synced:${result.trackingInfoCount}_trackings`
}

async function main() {
  const { days, dryRun, noNotify } = parseArgs()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const notify = !noNotify

  console.log(`[backfill-direct] since=${since} dry=${dryRun} notify=${notify}`)

  const orders = await fetchOrdersByStatus('completed', since)
  console.log(`[backfill-direct] ${orders.length} completed orders`)

  const store = await resolveStoreForRetailer('Florafy')
  if (!store) { console.error('Florafy store not resolved — check DB + env'); process.exit(1) }

  let synced = 0, skipped = 0, failed = 0

  for (const order of orders) {
    const match = getRetailerByTagId(order, ALLOWED_TAG_IDS)
    if (!match) continue
    if (!order.picklists || order.picklists.length === 0) continue

    for (const picklist of order.picklists) {
      try {
        const result = await processPicklist(picklist.idpicklist, store, match.retailerTag, dryRun, notify)
        const status = result.split(':')[0]
        if (status === 'synced' || status === 'would_sync') { synced++; console.log(`  ✓ order ${order.idorder} picklist ${picklist.idpicklist} → ${result}`) }
        else if (status === 'skipped') { skipped++; console.log(`  · order ${order.idorder} picklist ${picklist.idpicklist} → ${result}`) }
        else { failed++; console.log(`  ✗ order ${order.idorder} picklist ${picklist.idpicklist} → ${result}`) }
      } catch (e) {
        failed++
        console.error(`  ✗ order ${order.idorder} picklist ${picklist.idpicklist} → ERROR: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  console.log(`\n[backfill-direct] done. synced=${synced} skipped=${skipped} failed=${failed}`)
}

main().catch(e => { console.error('FATAL:', e); process.exit(1) })
