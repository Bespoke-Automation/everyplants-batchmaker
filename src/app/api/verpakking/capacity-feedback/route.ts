import { NextRequest, NextResponse } from 'next/server'
import {
  getCapacityFeedback,
  approveFeedback,
  rejectFeedback,
  getCoverageStats,
} from '@/lib/supabase/capacityFeedback'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/capacity-feedback?status=pending
 * GET /api/verpakking/capacity-feedback?coverage=true&days=7
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams

    // Coverage stats mode
    if (params.get('coverage') === 'true') {
      const days = parseInt(params.get('days') || '7', 10)
      const stats = await getCoverageStats(days)
      return NextResponse.json(stats)
    }

    // Feedback list mode
    const status = params.get('status') || undefined
    const feedback = await getCapacityFeedback(status)
    return NextResponse.json({ feedback, total: feedback.length })
  } catch (error) {
    console.error('[capacity-feedback] GET error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/capacity-feedback
 * { action: 'approve' | 'reject', id: string, approvedBy?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, id, approvedBy } = body

    if (!action || !id) {
      return NextResponse.json({ error: 'action en id zijn verplicht' }, { status: 400 })
    }

    if (action === 'approve') {
      await approveFeedback(id, approvedBy || 'manager')
      return NextResponse.json({ success: true, action: 'approved' })
    }

    if (action === 'reject') {
      await rejectFeedback(id, approvedBy || 'manager')
      return NextResponse.json({ success: true, action: 'rejected' })
    }

    return NextResponse.json({ error: `Onbekende actie: ${action}` }, { status: 400 })
  } catch (error) {
    console.error('[capacity-feedback] POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
