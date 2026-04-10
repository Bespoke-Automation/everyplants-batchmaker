import { NextRequest, NextResponse } from 'next/server'
import { getFingerprintStats } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/fingerprints
 * Returns the fingerprint library, sorted by total volume desc.
 */
export async function GET(request: NextRequest) {
  try {
    const limitParam = request.nextUrl.searchParams.get('limit')
    const limit = limitParam ? Math.max(1, Math.min(500, Number(limitParam))) : 200
    const rows = await getFingerprintStats(limit)
    return NextResponse.json({ rows })
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
