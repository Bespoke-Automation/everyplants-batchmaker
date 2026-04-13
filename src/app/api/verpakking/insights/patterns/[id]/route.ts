import { NextRequest, NextResponse } from 'next/server'
import { getLearnedPatternDetail } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/patterns/[id]
 * Drill-down for a single learned pattern including recent training sessions.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const detail = await getLearnedPatternDetail(id)
    if (!detail) {
      return NextResponse.json(
        { error: 'Patroon niet gevonden', id },
        { status: 404 },
      )
    }
    return NextResponse.json(detail)
  } catch (error) {
    console.error('[insights/patterns/[id]] error:', error)
    return NextResponse.json(
      {
        error: 'Patroon detail ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
