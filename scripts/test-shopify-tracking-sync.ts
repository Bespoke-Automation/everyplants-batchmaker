/**
 * End-to-end test runner for the Shopify tracking sync logic.
 *
 * Bypasses Inngest entirely — exercises the same Picqer + Shopify code paths
 * by hand so we can verify behavior against a real production order with full
 * visibility into each step.
 *
 * Usage:
 *   npx tsx scripts/test-shopify-tracking-sync.ts <picklist-id> [--apply] [--notify]
 *
 * Without --apply this is dry-run: it shows what would change but does not call
 * Shopify's mutation. --notify is only honored when --apply is also set.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import { fetchOrder, fetchPicklist, getPicklistShipments } from '../src/lib/picqer/client'
import { getRetailerByTagId } from '../src/lib/picqer/transform'
import { ORDERFIELD_IDS } from '../src/lib/picqer/types'
import {
  resolveStoreForRetailer,
  getOrder as getShopifyOrder,
  getFulfillmentOrders,
  extractPicqerLocationId,
  updateFulfillmentTracking,
} from '../src/lib/shopify/admin-client'

const ALLOWED_RETAILER_TAG_IDS: Record<string, number> = {
  Florafy: 252017,
}

interface Args {
  picklistId: number
  apply: boolean
  notify: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const positional = argv.filter(a => !a.startsWith('--'))
  const picklistId = Number(positional[0])
  if (!picklistId || Number.isNaN(picklistId)) {
    console.error('Usage: npx tsx scripts/test-shopify-tracking-sync.ts <picklist-id> [--apply] [--notify]')
    process.exit(1)
  }
  return {
    picklistId,
    apply: argv.includes('--apply'),
    notify: argv.includes('--notify'),
  }
}

function fmt(label: string, value: unknown) {
  console.log(`  ${label.padEnd(28)} ${typeof value === 'object' ? JSON.stringify(value) : value}`)
}

async function main() {
  const { picklistId, apply, notify } = parseArgs()
  console.log(`\n=== Shopify tracking sync test runner ===`)
  console.log(`  picklist ${picklistId} | apply=${apply} | notify=${notify}\n`)

  console.log('1. fetchPicklist')
  const picklist = await fetchPicklist(picklistId)
  fmt('idpicklist', picklist.idpicklist)
  fmt('idorder', picklist.idorder)
  fmt('status', picklist.status)

  console.log('\n2. fetchOrder')
  const order = await fetchOrder(picklist.idorder)
  fmt('orderid', order.orderid)
  fmt('reference', order.reference)
  const tags = Object.values(order.tags ?? {}).map(t => t.title)
  fmt('tags', tags)

  console.log('\n3. getPicklistShipments')
  const shipments = await getPicklistShipments(picklistId)
  fmt('count', shipments.length)
  for (const s of shipments) {
    console.log(`    - shipment ${s.idshipment} | ${s.public_providername || s.providername} | tracking=${s.trackingcode} cancelled=${s.cancelled}`)
  }

  console.log('\n4. retailer tag id check (allowlist hardlock by ID)')
  const orderTagIds = Object.values(order.tags ?? {}).map(t => t.idtag)
  fmt('order tag ids', orderTagIds)
  const match = getRetailerByTagId(order, ALLOWED_RETAILER_TAG_IDS)
  if (!match) {
    console.log(`  ❌ no allowed retailer tag id present — would skip`)
    return
  }
  fmt('matched retailer', match.retailerTag)
  fmt('matched tag id', match.tagId)
  const retailerTag = match.retailerTag
  console.log('  ✓ allowed by tag id')

  console.log('\n5. build picqer pairs')
  const pairs: { number: string; url: string }[] = []
  const seen = new Set<string>()
  for (const s of shipments) {
    if (s.cancelled) continue
    const num = s.trackingcode?.trim()
    if (!num || seen.has(num)) continue
    seen.add(num)
    pairs.push({ number: num, url: (s.trackingurl || s.tracktraceurl || '').trim() })
  }
  fmt('valid pairs', pairs.length)
  for (const p of pairs) console.log(`    - ${p.number}`)
  if (pairs.length < 2) {
    console.log('  ❌ <2 valid shipments — would skip (single_shipment)')
    return
  }

  console.log('\n6. carrier uniformity check')
  const carriers = new Set(
    shipments
      .filter(s => !s.cancelled && s.trackingcode)
      .map(s => (s.public_providername || s.providername || '').trim())
      .filter(Boolean),
  )
  fmt('carriers', Array.from(carriers))
  if (carriers.size > 1) {
    console.log('  ❌ mixed carriers — would skip')
    return
  }
  console.log('  ✓ single carrier')

  console.log('\n7. resolveStoreForRetailer (real production path via Supabase)')
  const store = await resolveStoreForRetailer(retailerTag)
  if (!store) {
    console.log('  ❌ store not found / disabled in DB — would skip')
    return
  }
  fmt('store_domain', store.storeDomain)
  fmt('api_version', store.apiVersion)
  fmt('config.retailer_tag', store.config.retailer_tag)
  fmt('tokenLoaded', store.adminToken ? `yes (${store.adminToken.length} chars)` : 'NO')
  if (store.config.retailer_tag !== retailerTag) {
    console.log('  ❌ store config mismatch — would fail')
    return
  }

  console.log('\n8. find Shopify order id (orderfield 3333)')
  const shopifyOrderIdStr = (order.orderfields ?? [])
    .find(f => f.idorderfield === ORDERFIELD_IDS.RETAILER_ORDER_NUMBER)
    ?.value?.trim()
  fmt('Retailer Ordernummer', shopifyOrderIdStr)
  if (!shopifyOrderIdStr || !/^\d+$/.test(shopifyOrderIdStr)) {
    console.log('  ❌ missing or invalid retailer order number')
    return
  }
  const shopifyOrderId = Number(shopifyOrderIdStr)

  console.log('\n9. fetch Shopify order + fulfillment_orders')
  const shopifyOrder = await getShopifyOrder(store, shopifyOrderId)
  if (!shopifyOrder) {
    console.log(`  ❌ order ${shopifyOrderId} not found in Shopify`)
    return
  }
  fmt('shopify name', shopifyOrder.name)
  fmt('fulfillment count', shopifyOrder.fulfillments?.length ?? 0)
  for (const f of shopifyOrder.fulfillments ?? []) {
    console.log(`    - fulfillment ${f.id} | status=${f.status} | location_id=${f.location_id} | tracking=${JSON.stringify(f.tracking_numbers)}`)
  }
  const fulfillmentOrders = await getFulfillmentOrders(store, shopifyOrderId)
  fmt('fulfillment_orders count', fulfillmentOrders.length)
  for (const fo of fulfillmentOrders) {
    console.log(`    - FO ${fo.id} | status=${fo.status} | location_id=${fo.assigned_location_id} | location_name=${fo.assigned_location?.name}`)
  }
  const picqerLocationId = extractPicqerLocationId(fulfillmentOrders)
  fmt('picqerLocationId', picqerLocationId)
  if (!picqerLocationId) {
    console.log('  ❌ no Picqer Fulfilment location on this order — would skip (not_picqer_fulfilment)')
    return
  }
  console.log(`  ✓ order is at Picqer location ${picqerLocationId}`)

  console.log('\n10. find matching fulfillment (must be at Picqer location)')
  const targetSet = new Set(pairs.map(p => p.number))
  const atPicqer = (shopifyOrder.fulfillments ?? []).filter(f => f.location_id === picqerLocationId)
  fmt('fulfillments at Picqer', atPicqer.length)
  let fulfillment = atPicqer.find(f =>
    (f.tracking_numbers ?? []).some(n => targetSet.has(n.trim())),
  )
  if (!fulfillment) {
    const active = atPicqer.filter(f => !f.status || f.status === 'success')
    if (active.length === 1) {
      fulfillment = active[0]
      console.log('  ⚠ no tracking match, using sole active Picqer-location fulfillment as fallback')
    }
  }
  if (!fulfillment) {
    console.log('  ❌ no matching fulfillment — would throw and Inngest would retry')
    return
  }
  fmt('fulfillment.id', fulfillment.id)
  fmt('fulfillment.status', fulfillment.status)
  fmt('existing tracking_numbers', fulfillment.tracking_numbers)

  if (fulfillment.status && fulfillment.status !== 'success') {
    console.log('  ❌ fulfillment not in success status — would skip')
    return
  }

  console.log('\n11. compute merged tracking set (existing ∪ picqer)')
  const merged = new Map<string, { number: string; url: string }>()
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
  const mergedArr = Array.from(merged.values())
  for (const p of mergedArr) {
    const existed = existingNums.some(n => n.trim() === p.number)
    console.log(`    ${existed ? '·' : '+'} ${p.number}`)
  }

  const noChange =
    mergedArr.length === existingNums.length &&
    mergedArr.every(p => existingNums.includes(p.number))
  if (noChange) {
    console.log('  ✓ already in sync — would skip (already_in_sync)')
    return
  }

  const carrier =
    store.config.carrier_override ||
    fulfillment.tracking_company ||
    shipments.find(s => !s.cancelled && s.trackingcode)?.public_providername ||
    shipments.find(s => !s.cancelled && s.trackingcode)?.providername ||
    'Other'
  fmt('carrier', carrier)

  if (!apply) {
    console.log('\n=== DRY RUN — pass --apply to actually patch Shopify ===')
    return
  }

  console.log('\n12. updateFulfillmentTracking (LIVE)')
  const result = await updateFulfillmentTracking(
    store,
    fulfillment.id,
    {
      company: carrier,
      numbers: mergedArr.map(p => p.number),
      urls: mergedArr.map(p => p.url),
    },
    notify,
  )
  fmt('result.id', result.id)
  fmt('result.trackingInfoCount', result.trackingInfoCount)

  console.log('\n13. re-fetch Shopify fulfillment to verify persistence')
  const verify = await getShopifyOrder(store, shopifyOrderId)
  const verifyFulfillment = (verify?.fulfillments ?? []).find(f => f.id === fulfillment!.id)
  fmt('verify tracking_numbers', verifyFulfillment?.tracking_numbers)
  fmt('verify tracking_company', verifyFulfillment?.tracking_company)

  console.log('\n=== END ===')
}

main().catch(err => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
