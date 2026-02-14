import { NextResponse } from 'next/server'
import { getTags } from '@/lib/picqer/client'
import { upsertTagsFromPicqer } from '@/lib/supabase/localTags'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sync/tags
 * Sync tags from Picqer into local database
 */
export async function POST() {
  try {
    const picqerTags = await getTags()

    const { added, updated } = await upsertTagsFromPicqer(picqerTags)

    return NextResponse.json({
      synced: picqerTags.length,
      added,
      updated,
    })
  } catch (error) {
    console.error('[verpakking] Error syncing tags:', error)
    return NextResponse.json(
      { error: 'Failed to sync tags', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
