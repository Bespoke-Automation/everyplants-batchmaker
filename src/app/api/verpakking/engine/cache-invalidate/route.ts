import { NextResponse } from 'next/server'
import { invalidateCostCache } from '@/lib/engine/costProvider'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/engine/cache-invalidate
 * Webhook endpoint for facturatie-app to invalidate the cost cache
 * when tariffs are recalculated.
 *
 * No auth required (internal network only, cache invalidation is safe).
 * The facturatie-app POSTs here after updating published_box_costs.
 */
export async function POST() {
  try {
    invalidateCostCache()
    console.log('[cache-invalidate] Cost cache invalidated via webhook')
    return NextResponse.json({ success: true, message: 'Cost cache invalidated' })
  } catch (error) {
    console.error('[cache-invalidate] Error:', error)
    return NextResponse.json(
      { error: 'Failed to invalidate cache', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
