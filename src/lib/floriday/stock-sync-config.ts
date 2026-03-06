// ══════════════════════════════════════════════════════════════
// Floriday Stock Sync Configuration
// ══════════════════════════════════════════════════════════════
//
// Kill switch en constanten voor de real-time stock sync pipeline.
// Picqer webhooks → debounced Inngest → Floriday bulk PUT.

/**
 * Kill switch: blokkeert webhook processing, cron sync, en reconciliation.
 * Zet FLORIDAY_STOCK_SYNC_DISABLED=true in Vercel env vars om uit te schakelen.
 */
export function isStockSyncDisabled(): boolean {
  return process.env.FLORIDAY_STOCK_SYNC_DISABLED === 'true'
}

/**
 * Picqer webhook events die stock-relevante wijzigingen signaleren.
 * Geregistreerd via POST /api/picqer/webhooks/register.
 */
export const PICQER_STOCK_WEBHOOK_EVENTS = [
  'products.free_stock_changed',
  'products.stock_changed',
  'receipts.product_received',
  'purchase_orders.changed',
  'purchase_orders.created',
] as const

export type PicqerStockWebhookEvent = typeof PICQER_STOCK_WEBHOOK_EVENTS[number]
