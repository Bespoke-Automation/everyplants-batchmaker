import { NextRequest, NextResponse } from 'next/server'
import { closePicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await closePicklist(Number(id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[picqer] Error closing picklist:', error)
    return NextResponse.json(
      { error: 'Failed to close picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
