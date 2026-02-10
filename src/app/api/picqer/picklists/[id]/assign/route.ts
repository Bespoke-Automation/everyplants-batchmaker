import { NextRequest, NextResponse } from 'next/server'
import { assignPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { userId } = body

    const result = await assignPicklist(Number(id), userId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[picqer] Error assigning picklist:', error)
    return NextResponse.json(
      { error: 'Failed to assign picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
