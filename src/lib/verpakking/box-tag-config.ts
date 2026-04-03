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
 * Tag IDs for orders that should be excluded from automatic box tag assignment.
 * - Plantura (252919): manages their own box tags
 * - Floriday (235531): orders from Floriday marketplace, handled separately
 */
export const PLANTURA_TAG_ID = 252919
export const FLORIDAY_TAG_ID = 235531
export const EXCLUDED_TAG_IDS = [PLANTURA_TAG_ID, FLORIDAY_TAG_ID] as const

/**
 * Picqer webhook events for order status changes.
 */
export const PICQER_ORDER_WEBHOOK_EVENTS = [
  'orders.status_changed',
] as const

export type PicqerOrderWebhookEvent = typeof PICQER_ORDER_WEBHOOK_EVENTS[number]
