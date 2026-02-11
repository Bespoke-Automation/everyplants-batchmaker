import { NextRequest, NextResponse } from 'next/server'
import { getSessionHistory, claimPicklist } from '@/lib/supabase/packingSessions'
import { assignPicklist, fetchPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions
 * Returns paginated session history
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const rawLimit = searchParams.get('limit')
    const rawOffset = searchParams.get('offset')
    const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : undefined
    const offset = rawOffset ? Math.max(parseInt(rawOffset, 10) || 0, 0) : undefined

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

    if (typeof picklistId !== 'number' || !Number.isInteger(picklistId)) {
      return NextResponse.json(
        { error: 'picklistId must be an integer' },
        { status: 400 }
      )
    }
    if (typeof assignedTo !== 'number' || !Number.isInteger(assignedTo)) {
      return NextResponse.json(
        { error: 'assignedTo must be an integer' },
        { status: 400 }
      )
    }
    if (typeof assignedToName !== 'string' || assignedToName.trim().length === 0) {
      return NextResponse.json(
        { error: 'assignedToName must be a non-empty string' },
        { status: 400 }
      )
    }

    // Validate picklist status in Picqer before claiming
    let picqerPicklist: Awaited<ReturnType<typeof fetchPicklist>> | null = null
    try {
      picqerPicklist = await fetchPicklist(picklistId)
    } catch (fetchError) {
      console.error('[verpakking] Failed to fetch picklist from Picqer:', fetchError)
      return NextResponse.json(
        { error: `Could not verify picklist status in Picqer: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` },
        { status: 502 }
      )
    }

    // Only allow claiming if picklist is in 'new' status (open and ready)
    if (picqerPicklist.status === 'closed') {
      return NextResponse.json(
        { error: `Picklist ${picklistId} is already closed in Picqer and cannot be claimed.` },
        { status: 409 }
      )
    }
    if (picqerPicklist.status === 'cancelled') {
      return NextResponse.json(
        { error: `Picklist ${picklistId} has been cancelled in Picqer and cannot be claimed.` },
        { status: 409 }
      )
    }
    if (picqerPicklist.status !== 'new') {
      return NextResponse.json(
        { error: `Picklist ${picklistId} has status '${picqerPicklist.status}' in Picqer. Only picklists with status 'new' can be claimed.` },
        { status: 409 }
      )
    }

    // Extract metadata from the Picqer picklist for enrichment
    const picqerPicklistId = picqerPicklist.picklistid
    const picqerOrderId = picqerPicklist.idorder

    // Claim the picklist in Supabase (checks for existing claims)
    const session = await claimPicklist(picklistId, assignedTo, assignedToName)

    // Update session with optional fields and Picqer metadata
    {
      const { updatePackingSession } = await import('@/lib/supabase/packingSessions')
      await updatePackingSession(session.id, {
        ...(orderId && { order_id: orderId }),
        ...(!orderId && picqerOrderId && { order_id: picqerOrderId }),
        ...(orderReference && { order_reference: orderReference }),
        ...(retailer && { retailer }),
        ...(deliveryCountry && { delivery_country: deliveryCountry }),
        ...(picklistid ? { picklistid } : picqerPicklistId ? { picklistid: picqerPicklistId } : {}),
      })
    }

    // Assign the picklist to the worker in Picqer
    let picqerAssignWarning: string | undefined
    try {
      await assignPicklist(picklistId, assignedTo)
    } catch (assignError) {
      console.error('[verpakking] Failed to assign picklist in Picqer:', assignError)
      picqerAssignWarning = 'Session created but Picqer assignment failed. Please assign manually in Picqer.'
    }

    return NextResponse.json({ ...session, warning: picqerAssignWarning })
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
