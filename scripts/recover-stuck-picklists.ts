/**
 * One-off recovery: patch specific picklists that got stuck in retries because
 * Picqer's Shopify sync was slower than our Inngest retry window.
 *
 * Usage:
 *   npx tsx scripts/recover-stuck-picklists.ts <picklistId> [<picklistId>...] [--notify]
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { fetchOrder, fetchPicklist, getPicklistShipments } from '../src/lib/picqer/client'
import { getRetailerByTagId } from '../src/lib/picqer/transform'
import { ORDERFIELD_IDS, type PicqerShipment } from '../src/lib/picqer/types'
import {
  resolveStoreForRetailer,
  getOrder as getShopifyOrder,
  getFulfillmentOrders,
  extractPicqerLocationId,
  updateFulfillmentTracking,
} from '../src/lib/shopify/admin-client'
import { supabase } from '../src/lib/supabase/client'

const ALLOWED = { Florafy: 252017 }

interface Pair { number: string; url: string }

function buildPairs(shipments: PicqerShipment[]): Pair[] {
  const seen = new Set<string>()
  const pairs: Pair[] = []
  for (const s of shipments) {
    if (s.cancelled) continue
    const n = s.trackingcode?.trim()
    if (!n || seen.has(n)) continue
    seen.add(n)
    pairs.push({ number: n, url: (s.trackingurl || s.tracktraceurl || '').trim() })
  }
  return pairs
}

async function recover(picklistId: number, notify: boolean): Promise<string> {
  const picklist = await fetchPicklist(picklistId)
  const order = await fetchOrder(picklist.idorder)
  const match = getRetailerByTagId(order, ALLOWED)
  if (!match) return 'skip:not_in_allowlist'

  const shipments = await getPicklistShipments(picklistId)
  const pairs = buildPairs(shipments)
  if (pairs.length < 2) return 'skip:single_shipment'

  const carriers = new Set(
    shipments.filter(s => !s.cancelled && s.trackingcode).map(s => (s.public_providername || s.providername || '').trim()).filter(Boolean),
  )
  if (carriers.size > 1) return `skip:mixed_carriers:${[...carriers].join(',')}`

  const store = await resolveStoreForRetailer(match.retailerTag)
  if (!store) return 'skip:store_disabled'

  const shopifyOrderIdStr = (order.orderfields ?? []).find(f => f.idorderfield === ORDERFIELD_IDS.RETAILER_ORDER_NUMBER)?.value?.trim()
  if (!shopifyOrderIdStr || !/^\d+$/.test(shopifyOrderIdStr)) return 'skip:no_retailer_order_number'
  const shopifyOrderId = Number(shopifyOrderIdStr)

  const shopifyOrder = await getShopifyOrder(store, shopifyOrderId)
  if (!shopifyOrder) return 'fail:shopify_order_not_found'

  const fos = await getFulfillmentOrders(store, shopifyOrderId)
  const picqerLocId = extractPicqerLocationId(fos)
  if (!picqerLocId) return 'skip:no_picqer_location'

  const atPicqer = (shopifyOrder.fulfillments ?? []).filter(f => f.location_id === picqerLocId)
  const targetSet = new Set(pairs.map(p => p.number))
  let fulfillment = atPicqer.find(f => (f.tracking_numbers ?? []).some(n => targetSet.has(n.trim())))
  if (!fulfillment) {
    const active = atPicqer.filter(f => !f.status || f.status === 'success')
    if (active.length === 1) fulfillment = active[0]
  }
  if (!fulfillment) return 'fail:no_matching_fulfillment_even_now'

  // Merge
  const merged = new Map<string, Pair>()
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
  if (noChange) return 'skip:already_in_sync'

  const carrier = fulfillment.tracking_company || 'Other'
  const result = await updateFulfillmentTracking(store, fulfillment.id, {
    company: carrier,
    numbers: mergedArr.map(p => p.number),
    urls: mergedArr.map(p => p.url),
  }, notify)

  await supabase.schema('batchmaker').from('shopify_tracking_sync_log').insert({
    picqer_order_id: picklist.idorder,
    picqer_picklist_id: picklistId,
    retailer_tag: match.retailerTag,
    shopify_order_id: shopifyOrderId,
    shopify_fulfillment_id: fulfillment.id,
    picqer_shipment_ids: shipments.map(s => s.idshipment),
    tracking_codes: mergedArr.map(p => p.number),
    tracking_urls: mergedArr.map(p => p.url),
    carrier,
    status: 'synced',
    synced_at: new Date().toISOString(),
  })

  return `synced:${result.trackingInfoCount}_trackings`
}

async function main() {
  const argv = process.argv.slice(2)
  const notify = argv.includes('--notify')
  const ids = argv.filter(a => !a.startsWith('--')).map(Number)
  if (ids.length === 0) { console.error('Usage: recover-stuck-picklists.ts <picklistId>...'); process.exit(1) }
  console.log(`Recovering ${ids.length} picklists, notify=${notify}\n`)
  for (const id of ids) {
    try {
      const r = await recover(id, notify)
      console.log(`  picklist ${id}: ${r}`)
    } catch (e) {
      console.log(`  picklist ${id}: ERROR ${e instanceof Error ? e.message : e}`)
    }
  }
}
main().catch(e => { console.error('FATAL:', e); process.exit(1) })
