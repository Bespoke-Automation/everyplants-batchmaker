import { NextRequest, NextResponse } from 'next/server'
import { fetchPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const picklist = await fetchPicklist(Number(id))

    return NextResponse.json({
      picklist,
    })
  } catch (error) {
    console.error('[picqer] Error fetching picklist:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
