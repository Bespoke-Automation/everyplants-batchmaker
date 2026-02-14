import { NextRequest, NextResponse } from 'next/server'
import { getBatchSession, updateBatchSession, getPackingSessionsForBatch } from '@/lib/supabase/batchSessions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/batch-sessions/[id]
 * Get batch session details with linked packing sessions
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const [batchSession, packingSessions] = await Promise.all([
      getBatchSession(id),
      getPackingSessionsForBatch(id),
    ])

    return NextResponse.json({
      ...batchSession,
      packing_sessions: packingSessions,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching batch session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/batch-sessions/[id]
 * Update batch session status
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, completedPicklists } = body

    const updates: Record<string, unknown> = {}

    if (status) {
      updates.status = status
      if (status === 'completed') {
        updates.completed_at = new Date().toISOString()
      }
    }

    if (completedPicklists !== undefined) {
      updates.completed_picklists = completedPicklists
    }

    const session = await updateBatchSession(id, updates)

    return NextResponse.json(session)
  } catch (error) {
    console.error('[verpakking] Error updating batch session:', error)
    return NextResponse.json(
      { error: 'Failed to update batch session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/verpakking/batch-sessions/[id]
 * Partial update (e.g. reassign batch)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const updates: Record<string, unknown> = {}
    if (body.assigned_to !== undefined) updates.assigned_to = body.assigned_to
    if (body.assigned_to_name !== undefined) updates.assigned_to_name = body.assigned_to_name

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const session = await updateBatchSession(id, updates)
    return NextResponse.json(session)
  } catch (error) {
    console.error('[verpakking] Error patching batch session:', error)
    return NextResponse.json(
      { error: 'Failed to update batch session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
