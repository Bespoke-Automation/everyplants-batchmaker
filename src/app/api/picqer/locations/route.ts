import { NextResponse } from 'next/server'
import { getLocations } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const locations = await getLocations()
    return NextResponse.json({ locations })
  } catch (error) {
    console.error('Error fetching Picqer locations:', error)
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 502 })
  }
}
