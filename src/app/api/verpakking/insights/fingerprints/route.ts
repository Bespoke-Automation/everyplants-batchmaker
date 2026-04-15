import { NextRequest, NextResponse } from 'next/server'
import { getFingerprintStats, getFingerprintStatsV2 } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/fingerprints?model=observation|legacy
 *
 * Returns the fingerprint library, sorted by total volume desc.
 *
 * - `model=legacy` (default): reads `packaging_advice.shipping_unit_fingerprint`
 *   via `getFingerprintStats()` — the original V1 behaviour.
 * - `model=observation`: reads `packing_observations` via
 *   `getFingerprintStatsV2()`. Returns an empty array when the table does
 *   not exist yet (parallel migration).
 */
export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam))) : 200

    const modelParam = request.nextUrl.searchParams.get('model')
    const model = modelParam === 'observation' ? 'observation' : 'legacy'

    const rows =
      model === 'observation'
        ? await getFingerprintStatsV2(limit)
        : await getFingerprintStats(limit)

    return NextResponse.json({ rows, model })
  } catch (error) {
    console.error('[insights/fingerprints] error:', error)
    return NextResponse.json(
      {
        error: 'Fingerprint stats ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
