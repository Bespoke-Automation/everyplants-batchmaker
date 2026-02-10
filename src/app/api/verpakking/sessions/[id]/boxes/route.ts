import { NextRequest, NextResponse } from 'next/server'
import { addBox, updateBox, removeBox } from '@/lib/supabase/packingSessions'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sessions/[id]/boxes
 * Adds a new box to the session
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    const body = await request.json()
    const { picqerPackagingId, packagingName, packagingBarcode, boxIndex } = body

    if (!packagingName || boxIndex === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: packagingName, boxIndex' },
        { status: 400 }
      )
    }

    const box = await addBox(sessionId, {
      picqer_packaging_id: picqerPackagingId,
      packaging_name: packagingName,
      packaging_barcode: packagingBarcode,
      box_index: boxIndex,
    })

    return NextResponse.json(box)
  } catch (error) {
    console.error('[verpakking] Error adding box:', error)
    return NextResponse.json(
      { error: 'Failed to add box', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/verpakking/sessions/[id]/boxes
 * Updates an existing box
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params // acknowledge route param
    const body = await request.json()
    const { boxId, ...updates } = body

    if (!boxId) {
      return NextResponse.json(
        { error: 'Missing required field: boxId' },
        { status: 400 }
      )
    }

    const updatedBox = await updateBox(boxId, updates)

    return NextResponse.json(updatedBox)
  } catch (error) {
    console.error('[verpakking] Error updating box:', error)
    return NextResponse.json(
      { error: 'Failed to update box', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/verpakking/sessions/[id]/boxes
 * Removes a box from the session
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params // acknowledge route param
    const body = await request.json()
    const { boxId } = body

    if (!boxId) {
      return NextResponse.json(
        { error: 'Missing required field: boxId' },
        { status: 400 }
      )
    }

    await removeBox(boxId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[verpakking] Error removing box:', error)
    return NextResponse.json(
      { error: 'Failed to remove box', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
