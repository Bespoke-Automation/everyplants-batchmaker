import { NextResponse } from 'next/server'
import { getCategoryLocations, saveCategoryLocations, type RaapCategory } from '@/lib/supabase/raapCategoryLocations'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const locations = await getCategoryLocations()
    return NextResponse.json({ locations })
  } catch (error) {
    console.error('Error fetching category locations:', error)
    return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { locations } = body as {
      locations: { picqer_location_id: number; picqer_location_name: string; category: RaapCategory }[]
    }
    await saveCategoryLocations(locations)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving category locations:', error)
    return NextResponse.json({ error: 'Failed to save locations' }, { status: 500 })
  }
}
