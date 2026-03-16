import { NextResponse } from 'next/server'
import { getVervoerders } from '@/lib/supabase/vervoerders'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const vervoerders = await getVervoerders()
    return NextResponse.json({ vervoerders })
  } catch (error) {
    console.error('Error fetching vervoerders:', error)
    return NextResponse.json({ error: 'Failed to fetch vervoerders' }, { status: 500 })
  }
}
