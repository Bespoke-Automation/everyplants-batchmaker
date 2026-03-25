import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/packing-stations
 * List all active packing stations
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .select('*')
      .eq('is_active', true)
      .order('name')

    if (error) throw error

    return NextResponse.json({ stations: data ?? [] })
  } catch (error) {
    console.error('[packing-stations] Error fetching stations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packing stations', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
