import { NextResponse } from 'next/server'
import {
  getGapMetrics,
  getLearningFunnel,
  getComplianceTrend,
} from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/overview
 * Bundled response for the /insights main dashboard.
 */
export async function GET() {
  try {
    const [gap, funnel, trend] = await Promise.all([
      getGapMetrics(),
      getLearningFunnel(),
      getComplianceTrend(12),
    ])

    return NextResponse.json({ gap, funnel, trend })
  } catch (error) {
    console.error('[insights/overview] error:', error)
    return NextResponse.json(
      {
        error: 'Insights overview ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
