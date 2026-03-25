import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/verpakking/packing-stations/delete
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const { error } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .delete()
      .eq('id', id)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[packing-stations] Error deleting station:', error)
    return NextResponse.json(
      { error: 'Failed to delete packing station', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
