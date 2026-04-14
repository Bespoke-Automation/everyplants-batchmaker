export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { listWebhooks, createWebhook, deleteWebhook, reactivateWebhook } from '@/lib/picqer/client'
import { PICQER_STOCK_WEBHOOK_EVENTS } from '@/lib/floriday/stock-sync-config'
import { PICQER_ORDER_WEBHOOK_EVENTS } from '@/lib/verpakking/box-tag-config'

const STOCK_WEBHOOK_ADDRESS = 'https://system.everyplants.com/api/picqer/webhooks/stock'
const ORDER_WEBHOOK_ADDRESS = 'https://system.everyplants.com/api/picqer/webhooks/orders'

// Legacy URLs — vercel.app now 307-redirects to system.everyplants.com, which
// Picqer does not follow. Included so `deregister` cleans them up.
const LEGACY_STOCK_WEBHOOK_ADDRESS = 'https://everyplants-batchmaker.vercel.app/api/picqer/webhooks/stock'
const LEGACY_ORDER_WEBHOOK_ADDRESS = 'https://everyplants-batchmaker.vercel.app/api/picqer/webhooks/orders'

const MANAGED_ADDRESSES = new Set([
  STOCK_WEBHOOK_ADDRESS,
  ORDER_WEBHOOK_ADDRESS,
  LEGACY_STOCK_WEBHOOK_ADDRESS,
  LEGACY_ORDER_WEBHOOK_ADDRESS,
])

/**
 * GET: List all registered webhooks.
 */
export async function GET() {
  try {
    const hooks = await listWebhooks()
    const stockHooks = hooks.filter(h => h.address === STOCK_WEBHOOK_ADDRESS)
    const orderHooks = hooks.filter(h => h.address === ORDER_WEBHOOK_ADDRESS)
    const legacyHooks = hooks.filter(
      h => h.address === LEGACY_STOCK_WEBHOOK_ADDRESS || h.address === LEGACY_ORDER_WEBHOOK_ADDRESS
    )

    const mapHook = (h: typeof hooks[number]) => ({
      idhook: h.idhook,
      event: h.event,
      active: h.active,
      name: h.name,
      address: h.address,
      created: h.created,
    })

    return NextResponse.json({
      total: hooks.length,
      stockHooks: stockHooks.map(mapHook),
      orderHooks: orderHooks.map(mapHook),
      legacyHooks: legacyHooks.map(mapHook),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST: Register, deregister, reactivate, or clean up legacy Picqer webhooks.
 *
 * Body: { action: "register" | "deregister" | "reactivate" | "cleanup-legacy" }
 *
 * - register: create any missing hooks on the current (system.everyplants.com) URLs
 * - deregister: delete all managed hooks (current AND legacy URLs)
 * - reactivate: reactivate inactive hooks on the current URLs
 * - cleanup-legacy: delete only legacy vercel.app hooks (keeps current ones intact)
 */
export async function POST(request: Request) {
  try {
    const { action } = await request.json()

    if (action === 'register') {
      const secret = process.env.PICQER_WEBHOOK_SECRET
      if (!secret) {
        return NextResponse.json(
          { error: 'PICQER_WEBHOOK_SECRET not configured' },
          { status: 400 }
        )
      }

      const existing = await listWebhooks()

      const created: string[] = []
      const skipped: string[] = []

      // Register stock webhooks
      const existingStockEvents = new Set(
        existing.filter(h => h.address === STOCK_WEBHOOK_ADDRESS).map(h => h.event)
      )

      for (const event of PICQER_STOCK_WEBHOOK_EVENTS) {
        if (existingStockEvents.has(event)) {
          skipped.push(event)
          continue
        }

        await createWebhook(
          `Stock Sync: ${event}`,
          event,
          STOCK_WEBHOOK_ADDRESS,
          secret
        )
        created.push(event)
      }

      // Register order webhooks (for automatic box tag assignment)
      const existingOrderEvents = new Set(
        existing.filter(h => h.address === ORDER_WEBHOOK_ADDRESS).map(h => h.event)
      )

      for (const event of PICQER_ORDER_WEBHOOK_EVENTS) {
        if (existingOrderEvents.has(event)) {
          skipped.push(event)
          continue
        }

        await createWebhook(
          `Box Tags: ${event}`,
          event,
          ORDER_WEBHOOK_ADDRESS,
          secret
        )
        created.push(event)
      }

      return NextResponse.json({
        action: 'register',
        created,
        skipped,
        total: created.length + skipped.length,
      })
    }

    if (action === 'deregister') {
      const existing = await listWebhooks()
      // Matches both current and legacy URLs so stale vercel.app hooks are cleaned up.
      const allManagedHooks = existing.filter(h => MANAGED_ADDRESSES.has(h.address))

      const deleted: Array<{ idhook: number; address: string; event: string }> = []
      for (const hook of allManagedHooks) {
        await deleteWebhook(hook.idhook)
        deleted.push({ idhook: hook.idhook, address: hook.address, event: hook.event })
      }

      return NextResponse.json({
        action: 'deregister',
        deleted,
        count: deleted.length,
      })
    }

    if (action === 'cleanup-legacy') {
      const existing = await listWebhooks()
      const legacyHooks = existing.filter(
        h => h.address === LEGACY_STOCK_WEBHOOK_ADDRESS || h.address === LEGACY_ORDER_WEBHOOK_ADDRESS
      )

      const deleted: Array<{ idhook: number; address: string; event: string }> = []
      for (const hook of legacyHooks) {
        await deleteWebhook(hook.idhook)
        deleted.push({ idhook: hook.idhook, address: hook.address, event: hook.event })
      }

      return NextResponse.json({
        action: 'cleanup-legacy',
        deleted,
        count: deleted.length,
      })
    }

    if (action === 'reactivate') {
      const existing = await listWebhooks()
      // Only reactivate hooks on the current URL — legacy ones should be deleted, not revived.
      const inactiveHooks = existing.filter(
        h => (h.address === STOCK_WEBHOOK_ADDRESS || h.address === ORDER_WEBHOOK_ADDRESS) && !h.active
      )

      const reactivated: number[] = []
      for (const hook of inactiveHooks) {
        await reactivateWebhook(hook.idhook)
        reactivated.push(hook.idhook)
      }

      return NextResponse.json({
        action: 'reactivate',
        reactivated,
        count: reactivated.length,
      })
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}. Use "register", "deregister", "cleanup-legacy", or "reactivate"` },
      { status: 400 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
