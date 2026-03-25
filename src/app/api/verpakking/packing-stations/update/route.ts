import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/verpakking/packing-stations/update
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, printnode_printer_id, printnode_printer_name, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates.name = name
    if (printnode_printer_id !== undefined) updates.printnode_printer_id = printnode_printer_id
    if (printnode_printer_name !== undefined) updates.printnode_printer_name = printnode_printer_name
    if (is_active !== undefined) updates.is_active = is_active

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error('[packing-stations] Error updating station:', error)
    return NextResponse.json(
      { error: 'Failed to update packing station', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
