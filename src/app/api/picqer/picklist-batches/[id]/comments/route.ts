import { NextRequest, NextResponse } from 'next/server'
import { getComments, addComment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches/[id]/comments
 * Fetch comments for a picklist batch
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    const comments = await getComments('picklists/batches', batchId)

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('[picqer] Error fetching batch comments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/picqer/picklist-batches/[id]/comments
 * Add a comment to a picklist batch
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    const { body } = await request.json()

    if (!body || typeof body !== 'string' || !body.trim()) {
      return NextResponse.json({ error: 'Comment body is required' }, { status: 400 })
    }

    const comment = await addComment('picklists/batches', batchId, body.trim())

    return NextResponse.json(comment)
  } catch (error) {
    console.error('[picqer] Error adding batch comment:', error)
    return NextResponse.json(
      { error: 'Failed to add comment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
