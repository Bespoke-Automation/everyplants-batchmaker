import { NextRequest, NextResponse } from 'next/server'
import { getBoxesBySession } from '@/lib/supabase/packingSessions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions/[id]/labels
 * Returns all labels for boxes in a session that have labels
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params

    const boxes = await getBoxesBySession(sessionId)

    // Filter to only boxes that have labels and map to label info
    const labels = boxes
      .filter(box => box.label_url)
      .map(box => ({
        boxIndex: box.box_index,
        labelUrl: box.label_url,
        trackingCode: box.tracking_code,
      }))

    return NextResponse.json(labels)
  } catch (error) {
    console.error('[verpakking] Error fetching session labels:', error)
    return NextResponse.json(
      { error: 'Failed to fetch session labels', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
