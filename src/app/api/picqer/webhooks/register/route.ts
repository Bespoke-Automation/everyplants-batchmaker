export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { listWebhooks, createWebhook, deleteWebhook, reactivateWebhook } from '@/lib/picqer/client'
import { PICQER_STOCK_WEBHOOK_EVENTS } from '@/lib/floriday/stock-sync-config'

const WEBHOOK_ADDRESS = 'https://everyplants-batchmaker.vercel.app/api/picqer/webhooks/stock'

/**
 * GET: List all registered webhooks.
 */
export async function GET() {
  try {
    const hooks = await listWebhooks()
    const stockHooks = hooks.filter(h => h.address === WEBHOOK_ADDRESS)

    return NextResponse.json({
      total: hooks.length,
      stockHooks: stockHooks.map(h => ({
        idhook: h.idhook,
        event: h.event,
        active: h.active,
        name: h.name,
        created: h.created,
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST: Register, deregister, or reactivate stock webhooks.
 *
 * Body: { action: "register" | "deregister" | "reactivate" }
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
      const existingEvents = new Set(
        existing.filter(h => h.address === WEBHOOK_ADDRESS).map(h => h.event)
      )

      const created: string[] = []
      const skipped: string[] = []

      for (const event of PICQER_STOCK_WEBHOOK_EVENTS) {
        if (existingEvents.has(event)) {
          skipped.push(event)
          continue
        }

        await createWebhook(
          `Stock Sync: ${event}`,
          event,
          WEBHOOK_ADDRESS,
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
      const stockHooks = existing.filter(h => h.address === WEBHOOK_ADDRESS)

      const deleted: number[] = []
      for (const hook of stockHooks) {
        await deleteWebhook(hook.idhook)
        deleted.push(hook.idhook)
      }

      return NextResponse.json({
        action: 'deregister',
        deleted,
        count: deleted.length,
      })
    }

    if (action === 'reactivate') {
      const existing = await listWebhooks()
      const inactiveHooks = existing.filter(
        h => h.address === WEBHOOK_ADDRESS && !h.active
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
      { error: `Unknown action: ${action}. Use "register", "deregister", or "reactivate"` },
      { status: 400 }
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
