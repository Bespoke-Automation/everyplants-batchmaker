import { NextResponse } from 'next/server'
import { getActiveSession, createSession } from '@/lib/supabase/raapSessions'
import type { RaapCategory } from '@/lib/supabase/raapCategoryLocations'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES: RaapCategory[] = ['kamerplanten', 'buitenplanten', 'kunstplanten', 'potten']

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') as RaapCategory
  const vervoerder_id = searchParams.get('vervoerder_id') || null

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  try {
    const session = await getActiveSession(category, vervoerder_id)
    return NextResponse.json({ session })
  } catch (error) {
    console.error('Error fetching session:', error)
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { category, vervoerder_id } = body as { category: RaapCategory; vervoerder_id?: string }

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
    }

    const session = await createSession(category, vervoerder_id || null)
    return NextResponse.json({ session })
  } catch (error) {
    console.error('Error creating session:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}
