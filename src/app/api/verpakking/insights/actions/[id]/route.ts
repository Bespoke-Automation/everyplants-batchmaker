import { NextRequest, NextResponse } from 'next/server'
import { snoozeAction, completeAction, dismissAction } from '@/lib/engine/insightsActions'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/insights/actions/[id]
 * Body: { action: 'snooze', duration: '24h' | '7d' | 'forever' }
 *     | { action: 'complete', resolvedBy?: string }
 *     | { action: 'dismiss' }
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
      case 'snooze': {
        const duration = body.duration as '24h' | '7d' | 'forever' | undefined
        if (!duration || !['24h', '7d', 'forever'].includes(duration)) {
          return NextResponse.json(
            { error: 'duration moet 24h, 7d of forever zijn' },
            { status: 400 },
          )
        }
        await snoozeAction(id, duration)
        return NextResponse.json({ ok: true, action: 'snoozed', id })
      }
      case 'complete': {
        await completeAction(id, body.resolvedBy)
        return NextResponse.json({ ok: true, action: 'completed', id })
      }
      case 'dismiss': {
        await dismissAction(id)
        return NextResponse.json({ ok: true, action: 'dismissed', id })
      }
      default:
        return NextResponse.json(
          { error: `Onbekende actie: ${action}` },
          { status: 400 },
        )
    }
  } catch (error) {
    console.error('[insights/actions/[id]] error:', error)
    return NextResponse.json(
      { error: 'Actie uitvoeren mislukt', details: error instanceof Error ? error.message : 'Onbekende fout' },
      { status: 500 },
    )
  }
}
