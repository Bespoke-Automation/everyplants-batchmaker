import { NextRequest, NextResponse } from 'next/server'
import { getRecentBatchCreations, getBatchCreationHistory } from '@/lib/supabase/batchCreations'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const page = parseInt(searchParams.get('page') || '0')
    const pageSize = parseInt(searchParams.get('pageSize') || '0')

    // If page/pageSize provided, return paginated results
    if (page > 0 && pageSize > 0) {
      const result = await getBatchCreationHistory(page, pageSize)
      return NextResponse.json(result)
    }

    // Otherwise return recent (for the notification popup)
    const creations = await getRecentBatchCreations(5)
    return NextResponse.json({ creations })
  } catch (error) {
    console.error('Error fetching batch history:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch history' },
      { status: 500 }
    )
  }
}
