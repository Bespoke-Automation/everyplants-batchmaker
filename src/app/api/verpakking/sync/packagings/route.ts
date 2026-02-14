import { NextResponse } from 'next/server'
import { getPackagings } from '@/lib/picqer/client'
import { upsertPackagingsFromPicqer } from '@/lib/supabase/localPackagings'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sync/packagings
 * Sync packagings from Picqer into local database
 */
export async function POST() {
  try {
    const picqerPackagings = await getPackagings()

    const { added, updated } = await upsertPackagingsFromPicqer(picqerPackagings)

    return NextResponse.json({
      synced: picqerPackagings.length,
      added,
      updated,
    })
  } catch (error) {
    console.error('[verpakking] Error syncing packagings:', error)
    return NextResponse.json(
      { error: 'Failed to sync packagings', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
