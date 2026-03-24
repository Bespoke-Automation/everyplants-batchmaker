import { NextRequest, NextResponse } from 'next/server'
import { getPackingSession } from '@/lib/supabase/packingSessions'
import { pickProduct, fetchPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sessions/[id]/auto-pick-packaging
 * Auto-picks packaging products (boxes that appear as line items) in Picqer.
 * These are products whose productcode matches a known packaging barcode.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params
    const body = await request.json()
    const { packagingProductCodes } = body as { packagingProductCodes: string[] }

    if (!Array.isArray(packagingProductCodes) || packagingProductCodes.length === 0) {
      return NextResponse.json(
        { error: 'packagingProductCodes must be a non-empty array' },
        { status: 400 }
      )
    }

    const session = await getPackingSession(sessionId)
    const picklist = await fetchPicklist(session.picklist_id)

    const codeSet = new Set(packagingProductCodes)
    const results: { productcode: string; picked: boolean; error?: string }[] = []

    for (const pp of picklist.products) {
      if (!codeSet.has(pp.productcode)) continue

      const amountToPick = pp.amount - pp.amount_picked
      if (amountToPick <= 0) {
        results.push({ productcode: pp.productcode, picked: true })
        continue
      }

      try {
        await pickProduct(session.picklist_id, pp.idpicklist_product, amountToPick)
        results.push({ productcode: pp.productcode, picked: true })
      } catch (pickError) {
        console.error(`[auto-pick-packaging] Failed to pick ${pp.productcode}:`, pickError)
        results.push({
          productcode: pp.productcode,
          picked: false,
          error: pickError instanceof Error ? pickError.message : 'Pick failed',
        })
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('[auto-pick-packaging] Error:', error)
    return NextResponse.json(
      { error: 'Failed to auto-pick packaging products', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
