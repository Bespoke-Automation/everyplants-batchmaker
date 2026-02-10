import { NextRequest, NextResponse } from 'next/server'
import { getSessionHistory, claimPicklist } from '@/lib/supabase/packingSessions'
import { assignPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions
 * Returns paginated session history
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : undefined
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!, 10) : undefined

    const result = await getSessionHistory({ limit, offset })

    return NextResponse.json({
      sessions: result.sessions,
      total: result.total,
    })
  } catch (error) {
    console.error('[verpakking] Error fetching session history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch session history', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/verpakking/sessions
 * Creates a new packing session by claiming a picklist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      picklistId,
      picklistid,
      orderId,
      orderReference,
      retailer,
      deliveryCountry,
      assignedTo,
      assignedToName,
    } = body

    if (!picklistId || !assignedTo || !assignedToName) {
      return NextResponse.json(
        { error: 'Missing required fields: picklistId, assignedTo, assignedToName' },
        { status: 400 }
      )
    }

    // Claim the picklist in Supabase (checks for existing claims)
    const session = await claimPicklist(picklistId, assignedTo, assignedToName)

    // Update session with optional fields if provided
    if (orderId || orderReference || retailer || deliveryCountry || picklistid) {
      const { updatePackingSession } = await import('@/lib/supabase/packingSessions')
      await updatePackingSession(session.id, {
        ...(orderId && { order_id: orderId }),
        ...(orderReference && { order_reference: orderReference }),
        ...(retailer && { retailer }),
        ...(deliveryCountry && { delivery_country: deliveryCountry }),
        ...(picklistid && { picklistid }),
      })
    }

    // Assign the picklist to the worker in Picqer
    try {
      await assignPicklist(picklistId, assignedTo)
    } catch (assignError) {
      console.error('[verpakking] Failed to assign picklist in Picqer (session still created):', assignError)
      // Session is still created, but Picqer assignment failed - log but don't fail
    }

    return NextResponse.json(session)
  } catch (error) {
    console.error('[verpakking] Error creating packing session:', error)

    // Check if it's a "already claimed" error
    if (error instanceof Error && error.message.includes('already claimed')) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create packing session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
