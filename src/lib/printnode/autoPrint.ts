import { supabase } from '@/lib/supabase/client'
import { submitPrintJob, isPrintNodeConfigured, getPrinter, type PrintNodePrinter } from './client'

/**
 * In-memory cache for packing station → printer info.
 * Avoids repeated Supabase + PrintNode lookups within the same function instance.
 * TTL: 5 minutes — balances freshness with avoiding redundant API calls.
 */
interface PrinterCacheEntry {
  printerId: number
  stationName: string
  printer: PrintNodePrinter | null
  cachedAt: number
}

const PRINTER_CACHE_TTL_MS = 5 * 60 * 1000
const printerCache = new Map<string, PrinterCacheEntry>()

async function getStationPrinter(
  packingStationId: string,
): Promise<{ printerId: number; stationName: string; printer: PrintNodePrinter | null } | null> {
  const cached = printerCache.get(packingStationId)
  if (cached && Date.now() - cached.cachedAt < PRINTER_CACHE_TTL_MS) {
    return cached
  }

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
    return null
  }

  // Check if the printer is reachable
  const printer = await getPrinter(station.printnode_printer_id)

  const entry: PrinterCacheEntry = {
    printerId: station.printnode_printer_id,
    stationName: station.name,
    printer,
    cachedAt: Date.now(),
  }
  printerCache.set(packingStationId, entry)

  return entry
}

/**
 * Try to auto-print a label via PrintNode.
 * Fire-and-forget: errors are logged but never thrown.
 * Uses a 5-minute cache for station/printer lookups to avoid redundant API calls.
 */
export async function tryAutoPrint(
  packingStationId: string | undefined,
  labelData: Buffer,
  shipmentId: number,
  boxId: string,
): Promise<void> {
  if (!packingStationId || !isPrintNodeConfigured()) return

  try {
    const stationInfo = await getStationPrinter(packingStationId)
    if (!stationInfo) return

    const { printer, stationName, printerId } = stationInfo

    if (!printer) {
      console.warn(`[autoPrint] Printer ${printerId} for station "${stationName}" not found in PrintNode`)
      return
    }
    if (printer.computer?.state !== 'connected') {
      console.warn(`[autoPrint] Computer "${printer.computer?.name}" for station "${stationName}" is ${printer.computer?.state ?? 'unknown'} — skipping print`)
      // Invalidate cache so the next call re-checks
      printerCache.delete(packingStationId)
      return
    }
    if (printer.state === 'offline') {
      console.warn(`[autoPrint] Printer "${printer.name}" at station "${stationName}" is offline — skipping print`)
      // Invalidate cache so the next call re-checks
      printerCache.delete(packingStationId)
      return
    }

    const pdfBase64 = labelData.toString('base64')
    const idempotencyKey = `shipment-${shipmentId}-box-${boxId}`

    const result = await submitPrintJob(
      printerId,
      `Label ${boxId.slice(0, 8)}`,
      pdfBase64,
      idempotencyKey,
    )

    if (result.success) {
      console.log(`[autoPrint] Label sent to printer at station "${stationName}" (job: ${result.printJobId})`)
    } else {
      console.warn(`[autoPrint] Failed to print label: ${result.error}`)
    }
  } catch (err) {
    console.error('[autoPrint] Unexpected error:', err)
  }
}
