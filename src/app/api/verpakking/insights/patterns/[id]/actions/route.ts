import { NextRequest, NextResponse } from 'next/server'
import {
  invalidateLearnedPattern,
  reactivateLearnedPattern,
} from '@/lib/engine/insights'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/insights/patterns/[id]/actions
 * Body: { action: 'invalidate' | 'reactivate', reason?: string }
 *
 * Manual control over learned pattern lifecycle. Used from the Insights UI
 * so operators can override the engine's automatic learning decisions.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const action = body.action as string | undefined

    if (!action) {
      return NextResponse.json({ error: 'action is verplicht' }, { status: 400 })
    }

    switch (action) {
      case 'invalidate': {
        const reason = typeof body.reason === 'string' ? body.reason : undefined
        await invalidateLearnedPattern(id, reason)
        return NextResponse.json({ ok: true, action, id })
      }
      case 'reactivate': {
        await reactivateLearnedPattern(id)
        return NextResponse.json({ ok: true, action, id })
      }
      default:
        return NextResponse.json(
          { error: `Onbekende actie: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[insights/patterns/[id]/actions] error:', error)
    return NextResponse.json(
      {
        error: 'Actie uitvoeren mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
