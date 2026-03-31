import { NextRequest, NextResponse } from 'next/server'
import { deleteTag, deactivatePackaging } from '@/lib/picqer/client'
import { deleteLocalPackaging } from '@/lib/supabase/localPackagings'
import { deleteLocalTag } from '@/lib/supabase/localTags'
import { getLocalTags } from '@/lib/supabase/localTags'
import { supabase } from '@/lib/supabase/client'

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

    // 1. Find the tag linked to this packaging via picqer_tag_name
    const { data: packaging } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('picqer_tag_name, picqer_tag_id')
      .eq('idpackaging', idpackaging)
      .single()

    // 2. If tag exists, delete it from Picqer + local
    let deletedTagTitle: string | null = null
    if (packaging?.picqer_tag_name) {
      const allTags = await getLocalTags()
      const localTag = allTags.find((t) => t.title === packaging.picqer_tag_name)

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
