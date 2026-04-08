import { NextRequest, NextResponse } from 'next/server'
import { pickAllProducts, closePicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const picklistId = Number(id)

    // Pick all products first (required before closing in Picqer)
    const pickResult = await pickAllProducts(picklistId)
    if (!pickResult.success) {
      console.warn(`[picqer] pickAll failed for picklist ${picklistId}, attempting close anyway:`, pickResult.error)
    }

    const result = await closePicklist(picklistId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to close picklist' },
        { status: 502 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[picqer] Error closing picklist:', error)
    return NextResponse.json(
      { error: 'Failed to close picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
