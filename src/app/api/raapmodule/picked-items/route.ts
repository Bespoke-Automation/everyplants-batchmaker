import { NextResponse } from 'next/server'
import { getPickedItems, recordPickedItems, cleanupClosedPicklistItems } from '@/lib/supabase/raapPickedItems'
import { fetchPicklist } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Cleanup: remove stale entries where picklist is now closed
    const pickedItems = await getPickedItems()
    const uniquePicklistIds = [...new Set(pickedItems.map(p => p.picklist_id))]
    const closedPicklistIds: number[] = []

    for (const picklistId of uniquePicklistIds) {
      try {
        const picklist = await fetchPicklist(picklistId)
        if (picklist.status === 'closed' || picklist.status === 'cancelled') {
          closedPicklistIds.push(picklistId)
        }
      } catch {
        closedPicklistIds.push(picklistId) // Picklist gone = done
      }
    }

    await cleanupClosedPicklistItems(closedPicklistIds)

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
