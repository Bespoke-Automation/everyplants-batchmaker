import { NextRequest, NextResponse } from 'next/server'
import { getGlobalComments } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/comments
 * Fetch global comments with optional filters
 * Query params: idauthor, idmentioned, offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const idauthor = searchParams.get('idauthor')
    const idmentioned = searchParams.get('idmentioned')
    const offset = searchParams.get('offset')

    const comments = await getGlobalComments({
      idauthor: idauthor ? parseInt(idauthor, 10) : undefined,
      idmentioned: idmentioned ? parseInt(idmentioned, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    })

    return NextResponse.json({ comments })
  } catch (error) {
    console.error('[picqer] Error fetching global comments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch comments', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
