import { NextRequest, NextResponse } from 'next/server'
import { createBatchSession, getActiveBatchSessions, getBatchSessionHistory } from '@/lib/supabase/batchSessions'
import { assignPicklistBatch } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/batch-sessions
 * Returns active batch sessions (for queue enrichment) or history
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const activeOnly = searchParams.get('active') === 'true'

    if (activeOnly) {
      const sessions = await getActiveBatchSessions()
      return NextResponse.json({ sessions })
    }

    // Paginated history
    const rawLimit = searchParams.get('limit')
    const rawOffset = searchParams.get('offset')
    const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : undefined
    const offset = rawOffset ? Math.max(parseInt(rawOffset, 10) || 0, 0) : undefined

    const result = await getBatchSessionHistory({ limit, offset })

    return NextResponse.json({
      sessions: result.sessions,
      total: result.total,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching batch sessions:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch sessions', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/batch-sessions
 * Claim a batch (create batch session + assign in Picqer)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { batchId, batchDisplayId, totalPicklists, assignedTo, assignedToName } = body

    if (!batchId || !assignedTo || !assignedToName) {
      return NextResponse.json(
        { error: 'Missing required fields: batchId, assignedTo, assignedToName' },
        { status: 400 }
      )
    }

    if (typeof batchId !== 'number' || !Number.isInteger(batchId)) {
      return NextResponse.json(
        { error: 'batchId must be an integer' },
        { status: 400 }
      )
    }
    if (typeof assignedTo !== 'number' || !Number.isInteger(assignedTo)) {
      return NextResponse.json(
        { error: 'assignedTo must be an integer' },
        { status: 400 }
      )
    }
    if (typeof assignedToName !== 'string' || assignedToName.trim().length === 0) {
      return NextResponse.json(
        { error: 'assignedToName must be a non-empty string' },
        { status: 400 }
      )
    }

    // Claim batch in Supabase
    const session = await createBatchSession(
      batchId,
      batchDisplayId || String(batchId),
      totalPicklists || 0,
      assignedTo,
      assignedToName
    )

    // Assign batch in Picqer
    let picqerAssignWarning: string | undefined
    try {
      await assignPicklistBatch(batchId, assignedTo)
    } catch (assignError) {
      console.error('[verpakking] Failed to assign batch in Picqer:', assignError)
      picqerAssignWarning = 'Batch session created but Picqer assignment failed. Please assign manually in Picqer.'
    }

    return NextResponse.json({ ...session, warning: picqerAssignWarning })
  } catch (error) {
    console.error('[verpakking] Error creating batch session:', error)

    if (error instanceof Error && error.message.includes('already claimed')) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create batch session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
