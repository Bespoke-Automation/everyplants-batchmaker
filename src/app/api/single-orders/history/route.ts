import { NextResponse } from 'next/server'
import { getBatchHistory } from '@/lib/supabase/shipmentLabels'

export const dynamic = 'force-dynamic'

/**
 * GET /api/single-orders/history
 *
 * Returns paginated batch history
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1', 10)
    const pageSize = parseInt(searchParams.get('pageSize') || '20', 10)

    // Validate parameters
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    const result = await getBatchHistory(page, pageSize)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching batch history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch history' },
      { status: 500 }
    )
  }
}
