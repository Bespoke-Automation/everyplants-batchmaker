import { NextRequest, NextResponse } from 'next/server'
import { getPackingSession, updatePackingSession } from '@/lib/supabase/packingSessions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions/[id]
 * Returns full session with boxes and products
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await getPackingSession(id)

    return NextResponse.json(session)
  } catch (error) {
    console.error('[verpakking] Error fetching packing session:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packing session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/sessions/[id]
 * Updates a packing session with partial updates
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const updatedSession = await updatePackingSession(id, body)

    return NextResponse.json(updatedSession)
  } catch (error) {
    console.error('[verpakking] Error updating packing session:', error)
    return NextResponse.json(
      { error: 'Failed to update packing session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
