import { NextRequest, NextResponse } from 'next/server'
import { getComments } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/picqer/picklist-batches/comment-counts
 * Fetch comment counts for multiple batch IDs
 * Body: { batchIds: number[] }
 * Returns: { counts: Record<number, number> }
 */
export async function POST(request: NextRequest) {
  try {
    const { batchIds } = await request.json()

    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      return NextResponse.json({ counts: {} })
    }

    // Fetch comments in small batches (Picqer allows 500 req/min, global limiter handles queuing)
    const CONCURRENCY = 3
    const counts: Record<number, number> = {}

    for (let i = 0; i < batchIds.length; i += CONCURRENCY) {
      const chunk = batchIds.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map(async (batchId: number) => {
          const comments = await getComments('picklists/batches', batchId)
          return { batchId, count: comments.length }
        })
      )

      for (const result of results) {
        if (result.status === 'fulfilled') {
          counts[result.value.batchId] = result.value.count
        }
      }
    }

    return NextResponse.json({ counts })
  } catch (error) {
    console.error('[picqer] Error fetching batch comment counts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comment counts', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
