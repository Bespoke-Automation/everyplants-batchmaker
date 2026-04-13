import { NextResponse } from 'next/server'
import { getWorkerComplianceStats } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/workers
 * Worker compliance overview — follow rate per worker based on
 * packaging_advice outcome, not was_override on boxes.
 */
export async function GET() {
  try {
    const rows = await getWorkerComplianceStats()
    return NextResponse.json({ rows })
  } catch (error) {
    console.error('[insights/workers] error:', error)
    return NextResponse.json(
      {
        error: 'Worker stats ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
