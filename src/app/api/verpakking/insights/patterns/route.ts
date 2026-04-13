import { NextRequest, NextResponse } from 'next/server'
import { getLearnedPatterns, type LearnedPatternsFilters } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/patterns
 * List learned packing patterns with filters:
 *   - status: learning | active | invalidated | all (default: all)
 *   - min: minimum times_seen (default: 0)
 *   - q: search query (productcode / name / packaging name substring)
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams
    const filters: LearnedPatternsFilters = {}

    const status = sp.get('status')
    if (status === 'learning' || status === 'active' || status === 'invalidated' || status === 'all') {
      filters.status = status
    }

    const minRaw = sp.get('min')
    if (minRaw) {
      const n = Number(minRaw)
      if (!Number.isNaN(n) && n >= 0) filters.minTimesSeen = n
    }

    const q = sp.get('q')
    if (q) filters.search = q

    const rows = await getLearnedPatterns(filters)
    return NextResponse.json({ rows })
  } catch (error) {
    console.error('[insights/patterns] error:', error)
    return NextResponse.json(
      {
        error: 'Geleerde patronen ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
