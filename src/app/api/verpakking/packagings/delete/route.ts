import { NextRequest, NextResponse } from 'next/server'
import { deleteTag, deactivatePackaging } from '@/lib/picqer/client'
import { deleteLocalPackaging } from '@/lib/supabase/localPackagings'
import { deleteLocalTag } from '@/lib/supabase/localTags'
import { getTagMappingByPackagingId, deleteTagMappingByPackagingId } from '@/lib/supabase/tagMappings'
import { getLocalTags } from '@/lib/supabase/localTags'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packagings/delete
 * Delete packaging: deactivate in Picqer, delete tag from Picqer, remove local data
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { idpackaging } = body

    if (!idpackaging || typeof idpackaging !== 'number') {
      return NextResponse.json(
        { error: 'Missing required field: idpackaging (number)' },
        { status: 400 }
      )
    }

    const errors: string[] = []

    // 1. Find tag mapping for this packaging
    const mapping = await getTagMappingByPackagingId(idpackaging)

    // 2. If mapping exists, find and delete the tag from Picqer
    let deletedTagTitle: string | null = null
    if (mapping) {
      // Find the local tag by title to get the idtag
      const allTags = await getLocalTags()
      const localTag = allTags.find((t) => t.title === mapping.tag_title)

      if (localTag) {
        try {
          await deleteTag(localTag.idtag)
          deletedTagTitle = localTag.title
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          console.warn(`[verpakking] Failed to delete tag from Picqer: ${msg}`)
          errors.push(`Tag kon niet uit Picqer verwijderd worden: ${msg}`)
        }

        // Delete local tag
        try {
          await deleteLocalTag(localTag.idtag)
        } catch (err) {
          console.warn('[verpakking] Failed to delete local tag:', err)
        }
      }

      // Delete mapping
      try {
        await deleteTagMappingByPackagingId(idpackaging)
      } catch (err) {
        console.warn('[verpakking] Failed to delete tag mapping:', err)
      }
    }

    // 3. Deactivate packaging in Picqer (no DELETE endpoint)
    try {
      await deactivatePackaging(idpackaging)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.warn(`[verpakking] Failed to deactivate packaging in Picqer: ${msg}`)
      errors.push(`Verpakking kon niet gedeactiveerd worden in Picqer: ${msg}`)
    }

    // 4. Delete local packaging
    await deleteLocalPackaging(idpackaging)

    return NextResponse.json({
      success: true,
      deletedTagTitle,
      deactivatedPackaging: idpackaging,
      warnings: errors.length > 0 ? errors : undefined,
    })
  } catch (error) {
    console.error('[verpakking] Error deleting packaging:', error)
    return NextResponse.json(
      { error: 'Failed to delete packaging', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
