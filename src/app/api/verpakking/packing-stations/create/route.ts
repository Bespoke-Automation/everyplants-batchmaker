import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packing-stations/create
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, printnode_printer_id, printnode_printer_name } = body

    if (!name || !printnode_printer_id) {
      return NextResponse.json(
        { error: 'name and printnode_printer_id are required' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .insert({
        name,
        printnode_printer_id,
        printnode_printer_name: printnode_printer_name ?? null,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error('[packing-stations] Error creating station:', error)
    return NextResponse.json(
      { error: 'Failed to create packing station', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
