import { NextResponse } from 'next/server'
import { getAdjustments, upsertAdjustment } from '@/lib/supabase/buitenplantenAdjustments'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const adjustments = await getAdjustments()
    return NextResponse.json({ adjustments })
  } catch (error) {
    console.error('Error fetching buitenplanten adjustments:', error)
    return NextResponse.json({ error: 'Failed to fetch adjustments' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { product_id, location, voorraad_bb, single_orders } = await request.json()
    await upsertAdjustment(product_id, location, voorraad_bb, single_orders)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving buitenplanten adjustment:', error)
    return NextResponse.json({ error: 'Failed to save adjustment' }, { status: 500 })
  }
}
