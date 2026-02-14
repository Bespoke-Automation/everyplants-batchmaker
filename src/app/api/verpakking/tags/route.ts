import { NextRequest, NextResponse } from 'next/server'
import { getLocalTags, getTagsByType, updateTagType } from '@/lib/supabase/localTags'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/tags?type=packaging
 * Returns local tags, optionally filtered by type
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    const tags = type ? await getTagsByType(type) : await getLocalTags()

    return NextResponse.json({
      tags,
      total: tags.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching local tags:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tags', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/tags
 * Update tag type classification
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { idtag, tag_type } = body

    if (!idtag || !tag_type) {
      return NextResponse.json(
        { error: 'Missing required fields: idtag, tag_type' },
        { status: 400 }
      )
    }

    if (!['packaging', 'plantura', 'other'].includes(tag_type)) {
      return NextResponse.json(
        { error: 'Invalid tag_type. Must be: packaging, plantura, or other' },
        { status: 400 }
      )
    }

    await updateTagType(idtag, tag_type)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error updating tag type:', error)
    return NextResponse.json(
      { error: 'Failed to update tag type', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
