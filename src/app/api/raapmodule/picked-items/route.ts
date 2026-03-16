import { NextResponse } from 'next/server'
import { getPickedItems, recordPickedItems } from '@/lib/supabase/raapPickedItems'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const items = await getPickedItems()
    return NextResponse.json({ items })
  } catch (error) {
    console.error('Error fetching picked items:', error)
    return NextResponse.json({ error: 'Failed to fetch picked items' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { items } = body
    await recordPickedItems(items)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error recording picked items:', error)
    return NextResponse.json({ error: 'Failed to record picked items' }, { status: 500 })
  }
}
