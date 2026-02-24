// ══════════════════════════════════════════════════════════════
// Floriday API Client
// ══════════════════════════════════════════════════════════════
//
// Rate-limited HTTP client voor de Floriday Suppliers API.
// Volgt hetzelfde patroon als src/lib/picqer/client.ts:
// - Concurrency limiter (max 3 parallel requests)
// - Exponential backoff bij 429
// - Automatische token refresh bij 401
//
// Floriday rate limits:
//   Sync endpoints:  3.4 req/sec (burst 1000)
//   Media upload:    2.0 req/sec (burst 200)
//   Continuous stock: 10 req/sec (burst 1000)

import { getFloridayToken, invalidateFloridayToken } from './auth'
import type { FloridaySyncResponse, FloridayTradeItem, FloridaySalesOrder, FloridaySupplyLine, FloridayOrganization, FloridayFulfillmentOrder, FloridayWarehouse } from './types'

import { getFloridayConfig } from './config'

// Rate limiting
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY_MS = 1000
const MAX_CONCURRENT_REQUESTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Concurrency limiter
let activeRequests = 0
const requestQueue: Array<() => void> = []

function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    requestQueue.push(() => {
      activeRequests++
      resolve()
    })
  })
}

function releaseSlot(): void {
  activeRequests--
  const next = requestQueue.shift()
  if (next) next()
}

/**
 * Rate-limited fetch met retry, auto-auth en 401 token refresh
 */
async function floridayFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  await acquireSlot()
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const token = await getFloridayToken()

      const config = getFloridayConfig()
      const response = await fetch(`${config.apiBaseUrl}${path}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Api-Key': config.apiKey,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      // Token verlopen → vernieuw en retry
      if (response.status === 401 && attempt < MAX_RETRIES - 1) {
        console.log('Floriday: 401 ontvangen, token vernieuwen...')
        invalidateFloridayToken()
        continue
      }

      // Rate limited → wacht en retry
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)

        console.log(`Floriday: Rate limited, wacht ${delayMs}ms (poging ${attempt + 1}/${MAX_RETRIES})`)
        await sleep(delayMs)
        continue
      }

      return response
    }

    throw new Error('Floriday: Max retries bereikt')
  } finally {
    releaseSlot()
  }
}

// ─── Generic HTTP methods ────────────────────────────────────

export async function floridayGet<T>(path: string): Promise<T> {
  const response = await floridayFetch(path)
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday GET ${path} error:`, response.status, errorText)
    throw new Error(`Floriday API error: ${response.status} - ${errorText}`)
  }
  return response.json()
}

export async function floridayPost<T>(path: string, body: unknown): Promise<T> {
  const response = await floridayFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday POST ${path} error:`, response.status, errorText)
    throw new Error(`Floriday API error: ${response.status} - ${errorText}`)
  }
  // Sommige POST endpoints retourneren 201 zonder body
  const text = await response.text()
  return text ? JSON.parse(text) : ({} as T)
}

export async function floridayPut(path: string, body: unknown): Promise<void> {
  const response = await floridayFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday PUT ${path} error:`, response.status, errorText)
    throw new Error(`Floriday API error: ${response.status} - ${errorText}`)
  }
}

export async function floridayPatch(path: string, body?: unknown): Promise<void> {
  const response = await floridayFetch(path, {
    method: 'PATCH',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday PATCH ${path} error:`, response.status, errorText)
    throw new Error(`Floriday API error: ${response.status} - ${errorText}`)
  }
}

export async function floridayDelete(path: string): Promise<void> {
  const response = await floridayFetch(path, { method: 'DELETE' })
  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Floriday DELETE ${path} error:`, response.status, errorText)
    throw new Error(`Floriday API error: ${response.status} - ${errorText}`)
  }
}

// ─── Sync helpers ────────────────────────────────────────────

/**
 * Haal max sequence number op voor een resource.
 */
export async function getMaxSequence(resource: string): Promise<number> {
  return floridayGet<number>(`/${resource}/current-max-sequence`)
}

/**
 * Sync records vanaf een sequence number.
 * Retourneert { maximumSequenceNumber, results }.
 *
 * Let op: nul results betekent NIET dat je up-to-date bent.
 * Blijf fetchen totdat maximumSequenceNumber == je huidige sequence.
 */
export async function syncFromSequence<T>(
  resource: string,
  fromSequence: number
): Promise<FloridaySyncResponse<T>> {
  return floridayGet<FloridaySyncResponse<T>>(`/${resource}/sync/${fromSequence}`)
}

/**
 * Volledige sync loop: fetch alle records tot je up-to-date bent.
 * Roept `onBatch` aan voor elke batch (max 1000 records).
 * Retourneert het laatste sequence number.
 */
export async function syncAll<T>(
  resource: string,
  fromSequence: number,
  onBatch: (results: T[], maxSeq: number) => Promise<void>
): Promise<number> {
  let currentSeq = fromSequence

  while (true) {
    const response = await syncFromSequence<T>(resource, currentSeq)
    const { maximumSequenceNumber, results } = response

    if (results.length > 0) {
      await onBatch(results, maximumSequenceNumber)
    }

    // Up-to-date als maximumSequenceNumber bereikt is
    if (maximumSequenceNumber <= currentSeq) {
      break
    }

    // Bepaal volgende sequence: hoogste uit results, of maxSequence als geen results
    if (results.length > 0) {
      const maxInBatch = Math.max(
        ...results.map((r: unknown) => (r as { sequenceNumber: number }).sequenceNumber)
      )
      currentSeq = maxInBatch + 1
    } else {
      // Nul results maar maxSequence is hoger → spring naar maxSequence
      // Dit kan door filtering (bijv. supply lines van niet-connected suppliers)
      currentSeq = maximumSequenceNumber
    }

    // Safety: als we precies op max zitten, stop
    if (currentSeq >= maximumSequenceNumber) {
      break
    }
  }

  return currentSeq
}

// ─── Trade Items ─────────────────────────────────────────────

export async function getTradeItem(tradeItemId: string): Promise<FloridayTradeItem> {
  return floridayGet<FloridayTradeItem>(`/trade-items/${tradeItemId}`)
}

export async function syncTradeItems(fromSequence: number): Promise<FloridaySyncResponse<FloridayTradeItem>> {
  return syncFromSequence<FloridayTradeItem>('trade-items', fromSequence)
}

// ─── Sales Orders ────────────────────────────────────────────

export async function getSalesOrder(salesOrderId: string): Promise<FloridaySalesOrder> {
  return floridayGet<FloridaySalesOrder>(`/sales-orders/${salesOrderId}`)
}

export async function syncSalesOrders(fromSequence: number): Promise<FloridaySyncResponse<FloridaySalesOrder>> {
  return syncFromSequence<FloridaySalesOrder>('sales-orders', fromSequence)
}

export async function commitSalesOrder(salesOrderId: string): Promise<void> {
  return floridayPatch(`/sales-orders/${salesOrderId}/commit`)
}

export async function cancelSalesOrder(salesOrderId: string): Promise<void> {
  return floridayPatch(`/sales-orders/${salesOrderId}/cancel`)
}

// ─── Supply Lines ────────────────────────────────────────────

export async function syncSupplyLines(fromSequence: number): Promise<FloridaySyncResponse<FloridaySupplyLine>> {
  return syncFromSequence<FloridaySupplyLine>('supply-lines', fromSequence)
}

export async function createSupplyLine(data: unknown): Promise<void> {
  await floridayPost('/supply-lines', data)
}

export async function updateSupplyLineStatus(
  supplyLineId: string,
  status: 'AVAILABLE' | 'UNAVAILABLE'
): Promise<void> {
  return floridayPatch(`/supply-lines/${supplyLineId}/status`, { status })
}

export async function updateSupplyLinePrice(
  supplyLineId: string,
  pricePerPiece: number
): Promise<void> {
  return floridayPatch(`/supply-lines/${supplyLineId}/price`, { pricePerPiece })
}

export async function deleteSupplyLine(supplyLineId: string): Promise<void> {
  return floridayDelete(`/supply-lines/${supplyLineId}`)
}

// ─── Batches (Stock) ─────────────────────────────────────────

export async function createBatch(data: unknown): Promise<void> {
  await floridayPost('/batches', data)
}

export async function cancelBatch(batchId: string): Promise<void> {
  return floridayPatch(`/batches/${batchId}/cancel`)
}

// ─── Organizations ───────────────────────────────────────────

export async function getOrganization(organizationId: string): Promise<FloridayOrganization> {
  return floridayGet<FloridayOrganization>(`/organizations/${organizationId}`)
}

// ─── Fulfillment Orders ─────────────────────────────────────

export async function syncFulfillmentOrders(fromSequence: number): Promise<FloridaySyncResponse<FloridayFulfillmentOrder>> {
  return syncFromSequence<FloridayFulfillmentOrder>('fulfillment-orders', fromSequence)
}

export async function getFulfillmentOrder(fulfillmentOrderId: string): Promise<FloridayFulfillmentOrder> {
  return floridayGet<FloridayFulfillmentOrder>(`/fulfillment-orders/${fulfillmentOrderId}`)
}

// ─── Warehouses ─────────────────────────────────────────────

export async function getWarehouses(): Promise<FloridayWarehouse[]> {
  return floridayGet<FloridayWarehouse[]>('/warehouses')
}

// ─── Webhooks ───────────────────────────────────────────────

export async function subscribeWebhook(callbackUrl: string): Promise<void> {
  await floridayPost('/webhooks/subscriptions', { callbackUrl })
}

export async function deleteWebhook(callbackUrl: string): Promise<void> {
  const response = await floridayFetch('/webhooks/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify({ callbackUrl }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Floriday webhook delete error: ${response.status} - ${errorText}`)
  }
}

// ─── Media Upload ────────────────────────────────────────────

export async function uploadMedia(
  buffer: Buffer,
  filename: string
): Promise<{ mediaId: string }> {
  const token = await getFloridayToken()
  const config = getFloridayConfig()

  const formData = new FormData()
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const blob = new Blob([arrayBuffer], { type: filename.endsWith('.png') ? 'image/png' : 'image/jpeg' })
  formData.append('file', blob, filename)

  const response = await fetch(`${config.apiBaseUrl}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-Api-Key': config.apiKey,
      // Geen Content-Type — FormData zet dit automatisch met boundary
    },
    body: formData,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Floriday media upload mislukt: ${response.status} - ${errorText}`)
  }

  return response.json()
}
