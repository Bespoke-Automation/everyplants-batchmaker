export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { inngest } from '@/inngest/client'
import { isBoxTagDisabled, PICQER_ORDER_WEBHOOK_EVENTS } from '@/lib/verpakking/box-tag-config'

// ── HMAC validation (same pattern as stock webhook) ──

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

// ── POST handler ──

export async function POST(request: Request) {
  const startTime = Date.now()

  try {
    const rawBody = await request.text()

    // 1. Kill switch
    if (isBoxTagDisabled()) {
      console.log('Order webhook: kill switch active — ignoring')
      return NextResponse.json({ action: 'disabled' })
    }

    // 2. HMAC validation
    const signature = request.headers.get('x-picqer-signature')
    if (!verifySignature(rawBody, signature)) {
      console.error('Order webhook: HMAC validation failed')
      return NextResponse.json({ action: 'rejected', reason: 'invalid_signature' })
    }

    // 3. Parse payload
    let payload: { event?: string; data?: Record<string, unknown> }
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.error('Order webhook: invalid JSON')
      return NextResponse.json({ action: 'rejected', reason: 'invalid_json' })
    }

    const event = payload.event
    const data = payload.data ?? {}

    if (!event || !PICQER_ORDER_WEBHOOK_EVENTS.includes(event as typeof PICQER_ORDER_WEBHOOK_EVENTS[number])) {
      return NextResponse.json({ action: 'ignored', reason: 'unknown_event', event })
    }

    // 4. Extract order ID
    const orderId = data.idorder as number | undefined
    if (!orderId) {
      console.warn('Order webhook: no idorder in payload')
      return NextResponse.json({ action: 'ignored', reason: 'no_order_id' })
    }

    // 5. Trigger Inngest function
    let inngestResult: unknown
    try {
      inngestResult = await inngest.send({
        name: 'orders/box-tag.requested',
        data: { orderId },
      })
      console.log(`Order webhook: sent Inngest event for order ${orderId}`)
    } catch (inngestErr) {
      console.error('Order webhook: Inngest send FAILED:', inngestErr)
    }

    const durationMs = Date.now() - startTime
    console.log(`Order webhook: ${event} → order ${orderId} (${durationMs}ms)`)

    return NextResponse.json({
      action: 'queued',
      orderId,
      duration_ms: durationMs,
      inngest: inngestResult ?? 'send_failed',
    })
  } catch (err) {
    // Always return 200 — Picqer deactivates webhooks after repeated non-2xx responses
    console.error('Order webhook error:', err)
    return NextResponse.json({
      action: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
