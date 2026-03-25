import { supabase } from '@/lib/supabase/client'
import { submitPrintJob, isPrintNodeConfigured } from './client'

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
