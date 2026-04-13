import { NextResponse } from 'next/server'
import { detectInsightsActions } from '@/lib/engine/insightsDetector'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/insights/actions/detect
 * Manually trigger action detection. Safe to call multiple times —
 * uses dedupe_key to prevent duplicates.
 */
export async function POST() {
  try {
    const result = await detectInsightsActions()
    return NextResponse.json(result)
  } catch (error) {
    console.error('[insights/actions/detect] error:', error)
    return NextResponse.json(
      { error: 'Detectie mislukt', details: error instanceof Error ? error.message : 'Onbekende fout' },
      { status: 500 },
    )
  }
}
