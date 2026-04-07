import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getPackingStations } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/packing-stations/sync
 * Sync packing stations from Picqer (import/update based on printnode_printer_id)
 */
export async function POST() {
  try {
    const picqerStations = await getPackingStations()

    if (picqerStations.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Geen packing stations gevonden in Picqer' })
    }

    // Filter stations that have a shipping label printer with a PrintNode ID
    const validStations = picqerStations.filter(
      (s) => s.printer_shipping_labels?.printnode_printerid
    )

    if (validStations.length === 0) {
      return NextResponse.json({ synced: 0, message: 'Geen stations met label printer gevonden in Picqer' })
    }

    // Fetch existing stations from our DB
    const { data: existing } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .select('id, printnode_printer_id')

    const existingByPrinterId = new Map(
      (existing ?? []).map((s) => [s.printnode_printer_id, s.id])
    )

    let created = 0
    let updated = 0

    const syncedPrinterIds: number[] = []

    for (const station of validStations) {
      const printer = station.printer_shipping_labels!
      const printerId = printer.printnode_printerid
      syncedPrinterIds.push(printerId)
      const existingId = existingByPrinterId.get(printerId)

      if (existingId) {
        // Update existing station
        await supabase
          .schema('batchmaker')
          .from('packing_stations')
          .update({
            name: station.name.trim(),
            printnode_printer_name: printer.name,
            is_active: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingId)
        updated++
      } else {
        // Create new station
        await supabase
          .schema('batchmaker')
          .from('packing_stations')
          .insert({
            name: station.name.trim(),
            printnode_printer_id: printerId,
            printnode_printer_name: printer.name,
            is_active: true,
          })
        created++
      }
    }

    // Deactivate stations whose printer ID is no longer in Picqer
    let deactivated = 0
    if (syncedPrinterIds.length > 0) {
      const { data: stale } = await supabase
        .schema('batchmaker')
        .from('packing_stations')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('is_active', true)
        .not('printnode_printer_id', 'in', `(${syncedPrinterIds.join(',')})`)
        .select('id')
      deactivated = stale?.length ?? 0
    }

    return NextResponse.json({
      synced: validStations.length,
      created,
      updated,
      deactivated,
      message: `${created} nieuw, ${updated} bijgewerkt, ${deactivated} gedeactiveerd van ${validStations.length} stations uit Picqer`,
    })
  } catch (error) {
    console.error('[packing-stations] Error syncing from Picqer:', error)
    return NextResponse.json(
      { error: 'Failed to sync packing stations', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
