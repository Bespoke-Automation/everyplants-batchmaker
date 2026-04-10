import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packing-stations/create
 *
 * Maakt een nieuw werkstation aan. Elk werkstation moet een eigen printer
 * hebben — als de gekozen printer al aan een ander actief werkstation hangt
 * wordt een 409 conflict teruggegeven met de naam van het conflicterende
 * werkstation zodat de UI dat kan tonen.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, printnode_printer_id, printnode_printer_name } = body

    if (!name || !printnode_printer_id) {
      return NextResponse.json(
        { error: 'Naam en printer zijn verplicht.' },
        { status: 400 },
      )
    }

    // Check of deze printer al gekoppeld is aan een actief werkstation
    const { data: conflict, error: conflictError } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .select('id, name')
      .eq('printnode_printer_id', printnode_printer_id)
      .eq('is_active', true)
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
      {
        error: 'Werkstation aanmaken mislukt.',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
