import { NextResponse } from 'next/server'
import { getRecentBatchCreations } from '@/lib/supabase/batchCreations'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
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
