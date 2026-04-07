import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getPrinters, isPrintNodeConfigured } from '@/lib/printnode/client'
import type { PrinterStatus } from '@/hooks/usePackingStation'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/packing-stations
 * List all active packing stations, enriched with live PrintNode printer status
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

    const stations = data ?? []

    // Enrich with live printer status from PrintNode
    if (isPrintNodeConfigured() && stations.length > 0) {
      try {
        const printers = await getPrinters()
        const printerMap = new Map(printers.map((p) => [p.id, p]))

        for (const station of stations) {
          const printer = printerMap.get(station.printnode_printer_id)
          if (!printer) {
            station.printer_status = 'unknown' as PrinterStatus
          } else {
            station.computer_name = printer.computer?.name ?? null
            if (printer.computer?.state !== 'connected') {
              station.printer_status = 'disconnected' as PrinterStatus
            } else if (printer.state === 'offline') {
              station.printer_status = 'offline' as PrinterStatus
            } else {
              station.printer_status = 'online' as PrinterStatus
            }
          }
        }
      } catch (err) {
        console.warn('[packing-stations] Could not fetch PrintNode status:', err)
        // Continue without status — stations still usable
      }
    }

    return NextResponse.json({ stations })
  } catch (error) {
    console.error('[packing-stations] Error fetching stations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch packing stations', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
