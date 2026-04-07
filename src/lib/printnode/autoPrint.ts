import { supabase } from '@/lib/supabase/client'
import { submitPrintJob, isPrintNodeConfigured, getPrinter } from './client'

/**
 * Try to auto-print a label via PrintNode.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function tryAutoPrint(
  packingStationId: string | undefined,
  labelData: Buffer,
  shipmentId: number,
  boxId: string,
): Promise<void> {
  if (!packingStationId || !isPrintNodeConfigured()) return

  try {
    // Fetch packing station to get printer ID
    const { data: station, error } = await supabase
      .schema('batchmaker')
      .from('packing_stations')
      .select('printnode_printer_id, name')
      .eq('id', packingStationId)
      .eq('is_active', true)
      .single()

    if (error || !station) {
      console.warn(`[autoPrint] Packing station ${packingStationId} not found or inactive`)
      return
    }

    // Check if the printer is reachable (online + connected computer)
    const printer = await getPrinter(station.printnode_printer_id)
    if (!printer) {
      console.warn(`[autoPrint] Printer ${station.printnode_printer_id} for station "${station.name}" not found in PrintNode`)
      return
    }
    if (printer.computer?.state !== 'connected') {
      console.warn(`[autoPrint] Computer "${printer.computer?.name}" for station "${station.name}" is ${printer.computer?.state ?? 'unknown'} — skipping print`)
      return
    }
    if (printer.state === 'offline') {
      console.warn(`[autoPrint] Printer "${printer.name}" at station "${station.name}" is offline — skipping print`)
      return
    }

    const pdfBase64 = labelData.toString('base64')
    const idempotencyKey = `shipment-${shipmentId}-box-${boxId}`

    const result = await submitPrintJob(
      station.printnode_printer_id,
      `Label ${boxId.slice(0, 8)}`,
      pdfBase64,
      idempotencyKey,
    )

    if (result.success) {
      console.log(`[autoPrint] Label sent to printer at station "${station.name}" (job: ${result.printJobId})`)
    } else {
      console.warn(`[autoPrint] Failed to print label: ${result.error}`)
    }
  } catch (err) {
    console.error('[autoPrint] Unexpected error:', err)
  }
}
