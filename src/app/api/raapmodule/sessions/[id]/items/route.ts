import { NextResponse } from 'next/server'
import { getSessionItems, upsertSessionItems } from '@/lib/supabase/raapSessions'
import type { RaapSessionItem } from '@/lib/supabase/raapSessions'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const items = await getSessionItems(id)
    return NextResponse.json({ items })
  } catch (error) {
    console.error('Error fetching session items:', error)
    return NextResponse.json({ error: 'Failed to fetch items' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    const { items } = body as { items: Omit<RaapSessionItem, 'id' | 'session_id' | 'created_at' | 'updated_at'>[] }
    await upsertSessionItems(id, items)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error upserting session items:', error)
    return NextResponse.json({ error: 'Failed to save items' }, { status: 500 })
  }
}
