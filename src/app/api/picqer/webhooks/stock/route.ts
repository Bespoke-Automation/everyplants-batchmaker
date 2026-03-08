export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabase } from '@/lib/supabase/client'
import { getPurchaseOrder } from '@/lib/picqer/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { isStockSyncDisabled, PICQER_STOCK_WEBHOOK_EVENTS } from '@/lib/floriday/stock-sync-config'
import { floridayInngest } from '@/inngest/floriday-client'

// ── In-memory cache for mapped product IDs (1 min TTL) ──────

let mappedProductIdsCache: Set<number> | null = null
let mappedProductIdsCacheTime = 0
const CACHE_TTL_MS = 60_000

async function getMappedProductIds(): Promise<Set<number>> {
  const now = Date.now()
  if (mappedProductIdsCache && now - mappedProductIdsCacheTime < CACHE_TTL_MS) {
    return mappedProductIdsCache
  }

  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id')
    .eq('environment', env)
    .eq('is_active', true)

  mappedProductIdsCache = new Set((data ?? []).map(r => r.picqer_product_id))
  mappedProductIdsCacheTime = now
  return mappedProductIdsCache
}

// ── HMAC validation ─────────────────────────────────────────

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.PICQER_WEBHOOK_SECRET
  if (!secret) {
    console.warn('PICQER_WEBHOOK_SECRET not set — skipping HMAC validation')
    return true
  }
  if (!signature) return false

  const expectedBuf = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest()

  const sigBuf = Buffer.from(signature, 'base64')
  if (sigBuf.length !== expectedBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expectedBuf)
}

// ── Extract product IDs from webhook payload ─────────────────

async function extractProductIds(
  event: string,
  data: Record<string, unknown>
): Promise<number[]> {
  // Direct product events: data.idproduct is the product ID
  if (
    event === 'products.free_stock_changed' ||
    event === 'products.stock_changed' ||
    event === 'receipts.product_received'
  ) {
    const id = data.idproduct
    if (typeof id === 'number') return [id]
    return []
  }

  // Purchase order events: fetch the PO to get product IDs
  // Only react to 'purchased' (PO confirmed) and 'changed' (products/dates modified).
  // 'created' is ignored because new POs are concept status and not yet in /expected.
  if (event === 'purchase_orders.purchased' || event === 'purchase_orders.changed') {
    const poId = data.idpurchaseorder
    if (typeof poId !== 'number') return []

    try {
      const po = await getPurchaseOrder(poId)

      // Only include POs with delivery within our sync window (~7 weeks)
      if (po.delivery_date) {
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() + 49) // ~7 weeks out
        if (new Date(po.delivery_date) > cutoff) {
          console.log(`PO ${poId} delivery ${po.delivery_date} is beyond sync window, skipping`)
          return []
        }
      }

      return po.products
        .filter(p => (p.amount - p.amountreceived) > 0)
        .map(p => p.idproduct)
    } catch (err) {
      console.error(`Failed to fetch PO ${poId}:`, err)
      return []
    }
  }

  return []
}

// ── POST handler ─────────────────────────────────────────────

export async function POST(request: Request) {
  const startTime = Date.now()

  // Always respond 200 to prevent Picqer from deactivating the webhook
  try {
    const rawBody = await request.text()

    // 1. Kill switch
    if (isStockSyncDisabled()) {
      return NextResponse.json({ action: 'disabled' })
    }

    // 2. HMAC validation
    const signature = request.headers.get('x-picqer-signature')
    if (!verifySignature(rawBody, signature)) {
      console.error('Stock webhook: HMAC validation failed')
      return NextResponse.json({ action: 'rejected', reason: 'invalid_signature' })
    }

    // 3. Parse payload
    let payload: { event?: string; data?: Record<string, unknown> }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.error('Stock webhook: invalid JSON')
      return NextResponse.json({ action: 'rejected', reason: 'invalid_json' })
    }

    const event = payload.event
    const data = payload.data ?? {}

    if (!event || !PICQER_STOCK_WEBHOOK_EVENTS.includes(event as typeof PICQER_STOCK_WEBHOOK_EVENTS[number])) {
      return NextResponse.json({ action: 'ignored', reason: 'unknown_event', event })
    }

    // 4. Extract product IDs
    const allProductIds = await extractProductIds(event, data)

    if (allProductIds.length === 0) {
      return NextResponse.json({ action: 'ignored', reason: 'no_products' })
    }

    // 5. Filter to mapped products only
    const mappedIds = await getMappedProductIds()
    const relevantProductIds = allProductIds.filter(id => mappedIds.has(id))

    if (relevantProductIds.length === 0) {
      return NextResponse.json({
        action: 'ignored',
        reason: 'no_mapped_products',
        total: allProductIds.length,
      })
    }

    // 6. INSERT into queue (partial unique index deduplicates pending items)
    // If a pending entry already exists for this product, the insert is silently ignored.
    // If the product is in processing/synced/error, a new pending entry is created.
    for (const productId of relevantProductIds) {
      const { error: insertError } = await supabase
        .schema('floriday')
        .from('stock_sync_queue')
        .insert({
          picqer_product_id: productId,
          trigger_event: event,
          trigger_data: data,
          status: 'pending',
        })

      // 23505 = unique_violation from partial unique index — product already pending, safe to ignore
      if (insertError && !insertError.code?.startsWith('23505')) {
        console.error(`Queue insert failed for product ${productId}:`, insertError.message)
      }
    }

    // 7. Trigger debounced Inngest function
    let inngestResult: unknown
    try {
      inngestResult = await floridayInngest.send({
        name: 'floriday/stock-sync.requested',
        data: {
          productIds: relevantProductIds,
          triggerEvent: event,
        },
      })
      console.log('Inngest send result:', JSON.stringify(inngestResult))
    } catch (inngestErr) {
      console.error('Inngest send FAILED:', inngestErr)
    }

    const durationMs = Date.now() - startTime
    console.log(
      `Stock webhook: ${event} → ${relevantProductIds.length} products queued (${durationMs}ms)`
    )

    return NextResponse.json({
      action: 'queued',
      products: relevantProductIds.length,
      duration_ms: durationMs,
      inngest: inngestResult ?? 'send_failed',
    })
  } catch (err) {
    // Always 200 to prevent Picqer deactivation
    console.error('Stock webhook error:', err)
    return NextResponse.json({
      action: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
