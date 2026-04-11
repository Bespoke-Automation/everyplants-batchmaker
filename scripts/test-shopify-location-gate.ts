/**
 * Standalone test of the Picqer-fulfilment-location gate.
 * Runs against a Shopify order id directly (no Picqer involvement).
 *
 * Usage:
 *   npx tsx scripts/test-shopify-location-gate.ts <retailer> <shopify-order-id>
 *
 * Example:
 *   npx tsx scripts/test-shopify-location-gate.ts Florafy 6429481205973
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
import {
  getOrder as getShopifyOrder,
  getFulfillmentOrders,
  extractPicqerLocationId,
  PICQER_LOCATION_NAMES,
  type ResolvedStore,
} from '../src/lib/shopify/admin-client'

function inlineStore(retailer: string): ResolvedStore | null {
  const map: Record<string, string> = {
    Florafy: 'SHOPIFY_FLORAFY',
    Trendyplants: 'SHOPIFY_TRENDYPLANTS',
  }
  const prefix = map[retailer]
  if (!prefix) return null
  const storeDomain = process.env[`${prefix}_STORE_DOMAIN`]
  const adminToken = process.env[`${prefix}_ADMIN_TOKEN`]
  if (!storeDomain || !adminToken) return null
  return {
    config: {
      retailer_tag: retailer,
      store_domain: storeDomain,
      env_var_prefix: prefix,
      api_version: '2025-01',
      enabled: true,
      tracking_sync_enabled: true,
      carrier_override: null,
    },
    storeDomain,
    adminToken,
    apiVersion: '2025-01',
  }
}

async function main() {
  const [, , retailer, orderIdStr] = process.argv
  if (!retailer || !orderIdStr) {
    console.error('Usage: npx tsx scripts/test-shopify-location-gate.ts <retailer> <shopify-order-id>')
    process.exit(1)
  }
  const orderId = Number(orderIdStr)
  const store = inlineStore(retailer)
  if (!store) {
    console.error(`No credentials for retailer ${retailer}`)
    process.exit(1)
  }

  console.log(`\n=== Picqer location gate test ===`)
  console.log(`  retailer=${retailer} order=${orderId} store=${store.storeDomain}\n`)

  const order = await getShopifyOrder(store, orderId)
  if (!order) {
    console.log('  ❌ order not found')
    return
  }
  console.log(`order: ${order.name}`)
  console.log(`fulfillments (${order.fulfillments?.length ?? 0}):`)
  for (const f of order.fulfillments ?? []) {
    console.log(`  - ${f.id} | location_id=${f.location_id} | status=${f.status} | tracking=${JSON.stringify(f.tracking_numbers)}`)
  }

  const fos = await getFulfillmentOrders(store, orderId)
  console.log(`\nfulfillment_orders (${fos.length}):`)
  for (const fo of fos) {
    console.log(`  - FO ${fo.id} | status=${fo.status} | location_id=${fo.assigned_location_id} | name="${fo.assigned_location?.name}"`)
  }

  console.log(`\nPICQER_LOCATION_NAMES = ${JSON.stringify(PICQER_LOCATION_NAMES)}`)
  const picqerLocId = extractPicqerLocationId(fos)
  console.log(`\nextractPicqerLocationId() => ${picqerLocId}`)

  if (!picqerLocId) {
    console.log('\n❌ ORDER WOULD BE SKIPPED with reason: no_picqer_fulfilment_location')
    console.log('   (this is the correct behaviour for non-Picqer orders)')
  } else {
    const matchAtPicqer = (order.fulfillments ?? []).filter(f => f.location_id === picqerLocId)
    console.log(`\n✓ Picqer location id resolved to ${picqerLocId}`)
    console.log(`✓ ${matchAtPicqer.length} fulfillment(s) at this location`)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
