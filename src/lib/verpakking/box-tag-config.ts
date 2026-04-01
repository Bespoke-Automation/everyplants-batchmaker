// ══════════════════════════════════════════════════════════════
// Automatic Box Tag Assignment Configuration
// ══════════════════════════════════════════════════════════════
//
// Kill switch and constants for the automatic box tag pipeline.
// Picqer webhook (orders.status_changed) → Inngest → engine preview → tag write.

/**
 * Kill switch: blocks webhook processing and Inngest function execution.
 * Set ORDER_BOX_TAG_DISABLED=true in Vercel env vars to disable.
 */
export function isBoxTagDisabled(): boolean {
  return process.env.ORDER_BOX_TAG_DISABLED === 'true'
}

/**
 * Plantura tag ID in Picqer — orders with this tag already get box tags
 * from Plantura's own system, so we skip them.
 */
export const PLANTURA_TAG_ID = 252919

/**
 * Picqer webhook events for order status changes.
 */
export const PICQER_ORDER_WEBHOOK_EVENTS = [
  'orders.status_changed',
] as const

export type PicqerOrderWebhookEvent = typeof PICQER_ORDER_WEBHOOK_EVENTS[number]
