import { NextRequest, NextResponse } from 'next/server'
import {
  getTagMappings,
  createTagMapping,
  updateTagMapping,
  deleteTagMapping,
} from '@/lib/supabase/tagMappings'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/tag-mappings
 * Returns all tag-to-packaging mappings
 */
export async function GET() {
  try {
    const mappings = await getTagMappings()

    return NextResponse.json({
      mappings,
      total: mappings.length,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching tag mappings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tag mappings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/tag-mappings
 * Creates a new tag-to-packaging mapping
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tagTitle, picqerPackagingId, packagingName, isActive } = body

    if (!tagTitle || !picqerPackagingId || !packagingName) {
      return NextResponse.json(
        { error: 'Missing required fields: tagTitle, picqerPackagingId, packagingName' },
        { status: 400 }
      )
    }

    const mapping = await createTagMapping({
      tag_title: tagTitle,
      picqer_packaging_id: picqerPackagingId,
      packaging_name: packagingName,
      is_active: isActive,
    })

    return NextResponse.json(mapping)
  } catch (error) {
    console.error('[verpakking] Error creating tag mapping:', error)
    return NextResponse.json(
      { error: 'Failed to create tag mapping', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/tag-mappings
 * Updates an existing tag-to-packaging mapping
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    // Convert camelCase body keys to snake_case for Supabase
    const snakeCaseUpdates: Record<string, unknown> = {}
    if (updates.tagTitle !== undefined) snakeCaseUpdates.tag_title = updates.tagTitle
    if (updates.picqerPackagingId !== undefined) snakeCaseUpdates.picqer_packaging_id = updates.picqerPackagingId
    if (updates.packagingName !== undefined) snakeCaseUpdates.packaging_name = updates.packagingName
    if (updates.isActive !== undefined) snakeCaseUpdates.is_active = updates.isActive

    const mapping = await updateTagMapping(id, snakeCaseUpdates)

    return NextResponse.json(mapping)
  } catch (error) {
    console.error('[verpakking] Error updating tag mapping:', error)
    return NextResponse.json(
      { error: 'Failed to update tag mapping', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/tag-mappings
 * Deletes a tag-to-packaging mapping
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    await deleteTagMapping(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error deleting tag mapping:', error)
    return NextResponse.json(
      { error: 'Failed to delete tag mapping', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
