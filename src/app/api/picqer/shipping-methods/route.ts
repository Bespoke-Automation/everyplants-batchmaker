import { NextRequest, NextResponse } from 'next/server'
import { getPicklistShippingMethods } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const picklistId = searchParams.get('picklistId')

    if (!picklistId) {
      return NextResponse.json(
        { error: 'Missing required parameter: picklistId' },
        { status: 400 }
      )
    }

    const picklistIdNum = parseInt(picklistId, 10)
    if (isNaN(picklistIdNum)) {
      return NextResponse.json(
        { error: 'Invalid picklistId: must be a number' },
        { status: 400 }
      )
    }

    const methods = await getPicklistShippingMethods(picklistIdNum)

    return NextResponse.json({
      methods,
      total: methods.length,
    })
  } catch (error) {
    console.error('Error fetching shipping methods:', error)
    return NextResponse.json(
      { error: 'Failed to fetch shipping methods', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
