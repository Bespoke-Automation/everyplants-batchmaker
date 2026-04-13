import { NextRequest, NextResponse } from 'next/server'
import { listActions, type InsightActionStatus } from '@/lib/engine/insightsActions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/actions?status=active&limit=10
 * Returns actions sorted by impact_score desc.
 * status=active (default) returns open + expired-snoozed.
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const status = (sp.get('status') ?? 'active') as InsightActionStatus | 'active'
    const limitRaw = sp.get('limit')
    const limit = limitRaw ? Math.max(1, Math.min(50, Number(limitRaw))) : 10

    const actions = await listActions(status, limit)
    return NextResponse.json({ actions })
  } catch (error) {
    console.error('[insights/actions] error:', error)
    return NextResponse.json(
      { error: 'Acties ophalen mislukt', details: error instanceof Error ? error.message : 'Onbekende fout' },
      { status: 500 },
    )
  }
}
