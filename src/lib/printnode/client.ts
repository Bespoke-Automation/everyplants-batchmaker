const PRINTNODE_API_KEY = process.env.PRINTNODE_API_KEY || ''
const PRINTNODE_BASE_URL = 'https://api.printnode.com'

function getAuthHeader(): string {
  return `Basic ${Buffer.from(PRINTNODE_API_KEY + ':').toString('base64')}`
}

export interface PrintNodePrinter {
  id: number
  name: string
  description: string | null
  state: string // "online" | "offline"
  computer: {
    id: number
    name: string
    state: string // "connected" | "disconnected"
  }
  capabilities: {
    papers?: Record<string, [number, number]>
    dpis?: string[]
    color?: boolean
    duplex?: boolean
  } | null
}

export interface PrintJobResult {
  success: boolean
  printJobId?: number
  error?: string
}

/**
 * Check if PrintNode is configured
 */
export function isPrintNodeConfigured(): boolean {
  return !!PRINTNODE_API_KEY
}

/**
 * Fetch all printers from PrintNode
 */
export async function getPrinters(): Promise<PrintNodePrinter[]> {
  if (!PRINTNODE_API_KEY) {
    console.warn('[printnode] No API key configured')
    return []
  }

  try {
    const response = await fetch(`${PRINTNODE_BASE_URL}/printers`, {
      headers: {
        'Authorization': getAuthHeader(),
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[printnode] Error fetching printers:', response.status, text)
      return []
    }

    const printers: PrintNodePrinter[] = await response.json()
    return printers
  } catch (error) {
    console.error('[printnode] Error fetching printers:', error)
    return []
  }
}

/**
 * Submit a print job to PrintNode
 */
export async function submitPrintJob(
  printerId: number,
  title: string,
  pdfBase64: string,
  idempotencyKey?: string,
): Promise<PrintJobResult> {
  if (!PRINTNODE_API_KEY) {
    return { success: false, error: 'PrintNode API key not configured' }
  }

  try {
    const headers: Record<string, string> = {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
    }

    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey
    }

    const response = await fetch(`${PRINTNODE_BASE_URL}/printjobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        printerId,
        title,
        contentType: 'pdf_base64',
        content: pdfBase64,
        source: 'EveryPlants Batchmaker',
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      // 409 = idempotency conflict (already submitted), treat as success
      if (response.status === 409) {
        console.log(`[printnode] Print job already submitted (idempotency): ${idempotencyKey}`)
        return { success: true }
      }
      console.error('[printnode] Error submitting print job:', response.status, text)
      return { success: false, error: `PrintNode error: ${response.status} - ${text}` }
    }

    const printJobId = await response.json()
    console.log(`[printnode] Print job submitted: ${printJobId} for printer ${printerId}`)

    return { success: true, printJobId: typeof printJobId === 'number' ? printJobId : undefined }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[printnode] Error submitting print job:', message)
    return { success: false, error: message }
  }
}
