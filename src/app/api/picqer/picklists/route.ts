import { NextRequest, NextResponse } from 'next/server'
import { getPicklists } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') || undefined
    const picklistid = searchParams.get('picklistid') || undefined
    const idpicklist_batch = searchParams.get('idpicklist_batch')

    const maxResults = searchParams.get('limit') ? Number(searchParams.get('limit')) : undefined

    const picklists = await getPicklists({
      status,
      picklistid,
      idpicklist_batch: idpicklist_batch ? Number(idpicklist_batch) : undefined,
      maxResults,
    })

    return NextResponse.json({
      picklists,
      total: picklists.length,
    })
  } catch (error) {
    console.error('[picqer] Error fetching picklists:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklists', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
