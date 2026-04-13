import { NextRequest, NextResponse } from 'next/server'
import { getWorkerDetail } from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/insights/workers/[id]
 * Detailed compliance view for a single worker.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const workerId = Number(id)
    if (Number.isNaN(workerId)) {
      return NextResponse.json({ error: 'Ongeldig worker ID' }, { status: 400 })
    }

    const detail = await getWorkerDetail(workerId)
    if (!detail) {
      return NextResponse.json(
        { error: 'Geen sessies gevonden voor deze medewerker' },
        { status: 404 },
      )
    }

    return NextResponse.json(detail)
  } catch (error) {
    console.error('[insights/workers/[id]] error:', error)
    return NextResponse.json(
      {
        error: 'Worker detail ophalen mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
