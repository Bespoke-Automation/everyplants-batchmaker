/**
 * Retroactive backfill of Shopify tracking codes for multi-shipment Picqer orders.
 *
 * For all Picqer orders from the last N days where a Florafy (or other configured)
 * retailer has >1 non-cancelled shipment on the picklist, re-fire the
 * shopify/tracking.sync event so the Inngest function patches the fulfillment.
 *
 * Usage:
 *   npx tsx scripts/backfill-shopify-tracking.ts --days 30 --retailer Florafy [--dry-run]
 */

import 'dotenv/config'
import { fetchOrdersByStatus, getPicklistShipments } from '../src/lib/picqer/client'
import { getRetailerTagFromOrder } from '../src/lib/picqer/transform'
import { triggerShopifyTrackingSync } from '../src/inngest/functions/syncShopifyTracking'

interface Args {
  days: number
  retailer: string
  dryRun: boolean
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const get = (flag: string, fallback?: string) => {
    const i = args.indexOf(flag)
    return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback
  }
  return {
    days: Number(get('--days', '30')),
    retailer: get('--retailer', 'Florafy')!,
    dryRun: args.includes('--dry-run'),
  }
}

async function main() {
  const { days, retailer, dryRun } = parseArgs()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  console.log(`[backfill] searching completed orders since ${since} for retailer ${retailer}${dryRun ? ' (dry run)' : ''}`)

  const orders = await fetchOrdersByStatus('completed', since)
  console.log(`[backfill] fetched ${orders.length} completed orders since ${since}`)

  let candidateCount = 0
  let fixedCount = 0

  for (const order of orders) {
    const tag = getRetailerTagFromOrder(order)
    if (tag !== retailer) continue
    if (!order.picklists || order.picklists.length === 0) continue

    for (const picklist of order.picklists) {
      let shipments
      try {
        shipments = await getPicklistShipments(picklist.idpicklist)
      } catch (e) {
        console.warn(`[backfill] failed to fetch shipments for picklist ${picklist.idpicklist}:`, e instanceof Error ? e.message : e)
        continue
      }

      const valid = shipments.filter(s => !s.cancelled && s.trackingcode)
      if (valid.length < 2) continue

      candidateCount++
      console.log(
        `[backfill] candidate: order ${order.idorder} picklist ${picklist.idpicklist} shipments=${valid.length} trackings=[${valid.map(s => s.trackingcode).join(', ')}]`,
      )

      if (!dryRun) {
        try {
          await triggerShopifyTrackingSync(picklist.idpicklist, `backfill-${days}d`)
          fixedCount++
          // Small delay to spread Inngest events
          await new Promise(r => setTimeout(r, 250))
        } catch (e) {
          console.error(`[backfill] failed to trigger sync for picklist ${picklist.idpicklist}:`, e instanceof Error ? e.message : e)
        }
      }
    }
  }

  console.log(`[backfill] done. candidates=${candidateCount} triggered=${fixedCount}${dryRun ? ' (dry run — nothing triggered)' : ''}`)
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
