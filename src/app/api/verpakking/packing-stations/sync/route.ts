import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getPackingStations } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packing-stations/sync
 *
 * Create-only import van Picqer packing stations. Alleen werkstations waarvan
 * de printer nog niet in onze DB staat worden toegevoegd. Bestaande rijen
 * worden NOOIT aangeraakt — onze DB is source of truth voor naam en printer-
 * koppeling. De Picqer API heeft geen update-endpoint voor packing stations,
 * dus two-way sync is niet mogelijk.
 */
export async function POST() {
  try {
    const picqerStations = await getPackingStations()

    if (picqerStations.length === 0) {
      return NextResponse.json({ created: 0, message: 'Geen packing stations gevonden in Picqer' })
    }

    // Filter stations that have a shipping label printer with a PrintNode ID
    const validStations = picqerStations.filter(
      (s) => s.printer_shipping_labels?.printnode_printerid
    )

    if (validStations.length === 0) {
      return NextResponse.json({ created: 0, message: 'Geen stations met label printer gevonden in Picqer' })
    }

    // Fetch existing printer IDs from our DB (both active and inactive — we never re-import)
    const { data: existing } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .select('printnode_printer_id')

    const existingPrinterIds = new Set((existing ?? []).map((s) => s.printnode_printer_id))

    // Only insert stations whose printer ID is not yet known locally
    const toInsert = validStations
      .filter((station) => !existingPrinterIds.has(station.printer_shipping_labels!.printnode_printerid))
      .map((station) => {
        const printer = station.printer_shipping_labels!
        return {
          name: station.name.trim(),
          printnode_printer_id: printer.printnode_printerid,
          printnode_printer_name: printer.name,
          is_active: true,
        }
      })

    let created = 0
    if (toInsert.length > 0) {
      const { data, error } = await supabase
        .schema('batchmaker')
        .from('packing_stations')
        .insert(toInsert)
        .select('id')

      if (error) throw error
      created = data?.length ?? 0
    }

    return NextResponse.json({
      created,
      message:
        created > 0
          ? `${created} ${created === 1 ? 'nieuw werkstation' : 'nieuwe werkstations'} geïmporteerd uit Picqer.`
          : 'Geen nieuwe werkstations gevonden. Alle Picqer-werkstations staan al in het systeem.',
    })
  } catch (error) {
    console.error('[packing-stations] Error importing from Picqer:', error)
    return NextResponse.json(
      {
        error: 'Import uit Picqer mislukt',
        details: error instanceof Error ? error.message : 'Onbekende fout',
      },
      { status: 500 },
    )
  }
}
