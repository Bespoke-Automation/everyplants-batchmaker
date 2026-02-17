import { NextRequest, NextResponse } from 'next/server'
import { getComments } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picqer/picklists/comments-bulk
 * Fetch comments for multiple picklists at once
 * Body: { picklistIds: number[] }
 * Returns: { comments: Record<number, Comment[]> }
 */
export async function POST(request: NextRequest) {
  try {
    const { picklistIds } = await request.json()

    if (!Array.isArray(picklistIds) || picklistIds.length === 0) {
      return NextResponse.json({ comments: {} })
    }

    const CONCURRENCY = 3
    const allComments: Record<number, unknown[]> = {}

    for (let i = 0; i < picklistIds.length; i += CONCURRENCY) {
      const chunk = picklistIds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map(async (picklistId: number) => {
          const comments = await getComments('picklists', picklistId)
          return { picklistId, comments }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          allComments[result.value.picklistId] = result.value.comments
        }
      }
    }

    return NextResponse.json({ comments: allComments })
  } catch (error) {
    console.error('[picqer] Error fetching bulk picklist comments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
