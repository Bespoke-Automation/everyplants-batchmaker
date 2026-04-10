import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/verpakking/packing-stations/update
 *
 * Wijzigt een bestaand werkstation. Als de nieuwe printer al aan een ander
 * actief werkstation hangt wordt een 409 conflict teruggegeven. De huidige
 * rij wordt uitgesloten van de check zodat het opnieuw opslaan zonder
 * printer-wijziging geen false positive geeft.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, printnode_printer_id, printnode_printer_name, is_active } = body

    if (!id) {
      return NextResponse.json({ error: 'id is verplicht.' }, { status: 400 })
    }

    // Check conflict alleen als de gebruiker daadwerkelijk een printer meegeeft
    if (printnode_printer_id !== undefined) {
      const { data: conflict, error: conflictError } = await supabase
        .schema('batchmaker')
        .from('packing_stations')
        .select('id, name')
        .eq('printnode_printer_id', printnode_printer_id)
        .eq('is_active', true)
        .neq('id', id)
        .maybeSingle()

      if (conflictError) throw conflictError

      if (conflict) {
        return NextResponse.json(
          {
            error: 'printer_conflict',
            conflictStationName: conflict.name,
            message: `Deze printer is al gekoppeld aan "${conflict.name}".`,
          },
          { status: 409 },
        )
      }
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
      {
        error: 'Werkstation bijwerken mislukt.',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
