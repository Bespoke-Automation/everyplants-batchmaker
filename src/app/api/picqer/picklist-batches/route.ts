import { NextRequest, NextResponse } from 'next/server'
import { getPicklistBatches } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches
 * Fetch picklist batches from Picqer
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || undefined
    const type = searchParams.get('type') || undefined
    const assigned_to_iduser = searchParams.get('assigned_to_iduser') ? Number(searchParams.get('assigned_to_iduser')) : undefined
    const maxResults = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined

    const batches = await getPicklistBatches({ status, type, assigned_to_iduser, maxResults })

    return NextResponse.json({
      batches,
      total: batches.length,
    })
  } catch (error) {
    console.error('[picqer] Error fetching picklist batches:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklist batches', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
