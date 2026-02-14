import { NextRequest, NextResponse } from 'next/server'
import { deleteComment } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/picqer/comments/[id]
 * Delete a comment by its ID
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const commentId = parseInt(id, 10)

    if (isNaN(commentId)) {
      return NextResponse.json({ error: 'Invalid comment ID' }, { status: 400 })
    }

    await deleteComment(commentId)

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[picqer] Error deleting comment:', error)
    return NextResponse.json(
      { error: 'Failed to delete comment', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
