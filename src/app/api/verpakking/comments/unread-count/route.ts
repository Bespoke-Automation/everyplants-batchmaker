import { NextRequest, NextResponse } from 'next/server'
import { getGlobalComments } from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/comments/unread-count?workerId=X
 * Returns the number of unresolved mentions for a worker
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const workerId = searchParams.get('workerId')

    if (!workerId) {
      return NextResponse.json({ error: 'workerId required' }, { status: 400 })
    }

    const workerIdNum = parseInt(workerId, 10)

    // Fetch mentions from Picqer
    const mentions = await getGlobalComments({ idmentioned: workerIdNum })

    if (mentions.length === 0) {
      return NextResponse.json({ count: 0 })
    }

    // Fetch resolved comment IDs for this worker
    const mentionIds = mentions.map(m => m.idcomment)
    const { data: resolutions } = await supabase
      .schema('batchmaker')
      .from('comment_resolutions')
      .select('idcomment')
      .eq('worker_id', workerIdNum)
      .in('idcomment', mentionIds)

    const resolvedCount = resolutions?.length ?? 0

    return NextResponse.json({ count: mentions.length - resolvedCount })
  } catch (error) {
    console.error('[verpakking/comments/unread-count] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch unread count', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
