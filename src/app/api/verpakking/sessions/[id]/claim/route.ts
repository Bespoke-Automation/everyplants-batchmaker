import { NextRequest, NextResponse } from 'next/server'
import { claimPicklist } from '@/lib/supabase/packingSessions'
import { assignPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sessions/[id]/claim
 * Claims a picklist for a worker and assigns it in Picqer
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params // acknowledge the route param (used for routing context)
    const body = await request.json()
    const {
      picklistId,
      picklistid,
      orderId,
      orderReference,
      retailer,
      deliveryCountry,
      workerId,
      workerName,
    } = body

    if (!picklistId || !workerId || !workerName) {
      return NextResponse.json(
        { error: 'Missing required fields: picklistId, workerId, workerName' },
        { status: 400 }
      )
    }

    // Claim the picklist in Supabase
    const session = await claimPicklist(picklistId, workerId, workerName)

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
      await assignPicklist(picklistId, workerId)
    } catch (assignError) {
      console.error('[verpakking] Failed to assign picklist in Picqer (claim still created):', assignError)
    }

    return NextResponse.json({
      success: true,
      sessionId: session.id,
    })
  } catch (error) {
    console.error('[verpakking] Error claiming picklist:', error)

    if (error instanceof Error && error.message.includes('already claimed')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { success: false, error: 'Failed to claim picklist', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
