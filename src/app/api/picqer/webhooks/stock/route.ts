export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { supabase } from '@/lib/supabase/client'
import { getPurchaseOrder } from '@/lib/picqer/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { isStockSyncDisabled, PICQER_STOCK_WEBHOOK_EVENTS } from '@/lib/floriday/stock-sync-config'
import { inngest } from '@/inngest/client'
import { getNextNWeeks } from '@/lib/floriday/utils'

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

  const expected = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  )
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
  if (event === 'purchase_orders.changed' || event === 'purchase_orders.created') {
    const poId = data.idpurchaseorder
    if (typeof poId !== 'number') return []

    try {
      const po = await getPurchaseOrder(poId)

      // Only include POs with delivery within our sync window (6 weeks)
      if (po.delivery_date) {
        const weeks = getNextNWeeks(7) // 6 weeks + 1 for look-ahead
        const lastWeekEnd = new Date()
        lastWeekEnd.setDate(lastWeekEnd.getDate() + 7 * 7) // ~7 weeks out

        const deliveryDate = new Date(po.delivery_date)
        if (deliveryDate > lastWeekEnd) {
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

    // 6. UPSERT into queue (deduplication via partial unique index)
    for (const productId of relevantProductIds) {
      await supabase
        .schema('floriday')
        .from('stock_sync_queue')
        .upsert(
          {
            picqer_product_id: productId,
            trigger_event: event,
            trigger_data: data,
            status: 'pending',
            created_at: new Date().toISOString(),
          },
          { onConflict: 'picqer_product_id', ignoreDuplicates: false }
        )
    }

    // 7. Trigger debounced Inngest function
    await inngest.send({
      name: 'floriday/stock-sync.requested',
      data: {
        productIds: relevantProductIds,
        triggerEvent: event,
      },
    })

    const durationMs = Date.now() - startTime
    console.log(
      `Stock webhook: ${event} → ${relevantProductIds.length} products queued (${durationMs}ms)`
    )

    return NextResponse.json({
      action: 'queued',
      products: relevantProductIds.length,
      duration_ms: durationMs,
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
