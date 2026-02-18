import { PicqerOrder, PicqerPicklist, PicqerPicklistWithProducts, PicqerProduct, PicqerTag, PicqerShipment, CreateShipmentResult, CancelShipmentResult, GetLabelResult, PicqerPackaging, ShippingMethod, PicqerUser, PicqerPicklistBatch, PicqerBatchPicklist, type MulticolloParcelInput, PicqerProductFull, PicqerCompositionPart, PicqerCustomer, CreateOrderInput, PicqerProductStock, PicqerPurchaseOrder } from './types'

const PICQER_SUBDOMAIN = process.env.PICQER_SUBDOMAIN!
const PICQER_API_KEY = process.env.PICQER_API_KEY!

const PICQER_BASE_URL = `https://${PICQER_SUBDOMAIN}.picqer.com/api/v1`

// Rate limiting configuration
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY_MS = 2000
// Picqer allows 500 req/min. Limit concurrent requests to prevent stampedes.
const MAX_CONCURRENT_REQUESTS = 3

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Global concurrency limiter for all Picqer API requests
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
 * Make a rate-limited fetch request with retry logic for 429 errors.
 * Uses a global concurrency limiter to prevent API stampedes.
 */
async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  await acquireSlot()
  try {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const response = await fetch(url, options)

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)

        console.log(`Rate limited, waiting ${delayMs}ms before retry (attempt ${attempt + 1}/${MAX_RETRIES})...`)
        await sleep(delayMs)
        continue
      }

      return response
    }

    throw lastError || new Error('Max retries exceeded due to rate limiting')
  } finally {
    releaseSlot()
  }
}

interface FetchOrdersOptions {
  status?: string
  offset?: number
}

/**
 * Fetch orders from Picqer API with pagination
 */
export async function fetchOrders(options: FetchOrdersOptions = {}): Promise<PicqerOrder[]> {
  const { status = 'processing', offset = 0 } = options

  const params = new URLSearchParams({
    status,
    offset: offset.toString(),
  })

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders?${params}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store', // Always fetch fresh data
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Fetch all processing orders with pagination (up to 3000 orders)
 * Always fetches fresh data from Picqer API
 */
export async function fetchAllOrders(): Promise<PicqerOrder[]> {
  const allOrders: PicqerOrder[] = []
  let offset = 0
  const limit = 100 // Picqer returns 100 per request by default

  console.log('Starting to fetch orders from Picqer...')

  while (true) {
    console.log(`Fetching orders with offset ${offset}...`)
    const orders = await fetchOrders({ offset })
    allOrders.push(...orders)

    console.log(`Fetched ${orders.length} orders (total: ${allOrders.length})`)

    // If we received fewer than limit, we've reached the end
    if (orders.length < limit) {
      break
    }

    offset += limit

    // Safety limit: max 3000 orders (30 requests)
    if (offset >= 3000) {
      console.log('Reached safety limit of 3000 orders')
      break
    }
  }

  console.log(`Total orders fetched: ${allOrders.length}`)

  return allOrders
}

/**
 * Fetch a single picklist with its products
 */
export async function fetchPicklist(idpicklist: number): Promise<PicqerPicklistWithProducts> {
  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/picklists/${idpicklist}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error fetching picklist:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Fetch a single product with its tags
 */
export async function fetchProduct(idproduct: number): Promise<PicqerProduct> {
  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products/${idproduct}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error fetching product:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Fetch products by tag name with pagination
 */
export async function fetchProductsByTag(tagName: string): Promise<PicqerProduct[]> {
  const allProducts: PicqerProduct[] = []
  let offset = 0
  const limit = 100

  console.log(`Fetching products with tag "${tagName}" from Picqer...`)

  while (true) {
    const params = new URLSearchParams({
      tag: tagName,
      offset: offset.toString(),
    })

    const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products?${params}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching products by tag:', response.status, errorText)
      throw new Error(`Picqer API error: ${response.status}`)
    }

    const products: PicqerProduct[] = await response.json()
    allProducts.push(...products)

    console.log(`Fetched ${products.length} products (total: ${allProducts.length})`)

    if (products.length < limit) {
      break
    }

    offset += limit

    // Safety limit: max 1000 products
    if (offset >= 1000) {
      console.log('Reached safety limit of 1000 products')
      break
    }
  }

  console.log(`Total products with tag "${tagName}": ${allProducts.length}`)
  return allProducts
}

/**
 * Response from creating a picklist batch
 */
export interface CreateBatchResult {
  idpicklist_batch: number
  batchid: string
  status: string
  created: string
}

/**
 * Create a picklist batch from a list of picklist IDs
 */
export async function createPicklistBatch(picklistIds: number[]): Promise<CreateBatchResult> {
  console.log(`Creating batch with ${picklistIds.length} picklists...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/picklists/batches`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idpicklists: picklistIds }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error creating batch:', response.status, errorText)
    throw new Error(`Failed to create batch: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  console.log(`Batch created: ${result.idpicklist_batch}`)

  return result
}

/**
 * Get all active packagings from Picqer
 */
export async function getPackagings(): Promise<PicqerPackaging[]> {
  console.log('Fetching packagings from Picqer...')

  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/packagings`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching packagings:', response.status, errorText)
      return []
    }

    const packagings: PicqerPackaging[] = await response.json()
    console.log(`Found ${packagings.length} packagings:`, packagings.map(p => p.name).join(', '))
    return packagings
  } catch (error) {
    console.error('Error fetching packagings:', error)
    return []
  }
}

/**
 * Get all tags from Picqer
 */
export async function getTags(): Promise<PicqerTag[]> {
  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/tags`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching tags:', response.status, errorText)
      return []
    }

    const tags: PicqerTag[] = await response.json()
    return tags
  } catch (error) {
    console.error('Error fetching tags:', error)
    return []
  }
}

/**
 * Get available shipping methods for a picklist
 */
export async function getPicklistShippingMethods(picklistId: number): Promise<ShippingMethod[]> {
  console.log(`Fetching shipping methods for picklist ${picklistId}...`)

  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/shippingmethods`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error fetching shipping methods for picklist ${picklistId}:`, response.status, errorText)
      return []
    }

    const methods: ShippingMethod[] = await response.json()
    console.log(`Found ${methods.length} shipping methods for picklist ${picklistId}:`, methods.map(m => `${m.name} (${m.idshippingprovider_profile})`).join(', '))
    return methods
  } catch (error) {
    console.error(`Error fetching shipping methods for picklist ${picklistId}:`, error)
    return []
  }
}

/**
 * Create a shipment for a picklist
 * This triggers the carrier to generate a shipping label
 * Fetches picklist details to get shipping provider and weight
 * @param picklistId - The picklist ID to create a shipment for
 * @param shippingProviderId - Optional shipping provider profile ID to override the picklist's default
 * @param packagingId - Optional packaging ID to specify the packaging used for this shipment
 */
export async function createShipment(
  picklistId: number,
  shippingProviderId?: number,
  packagingId?: number | null,
  weightOverride?: number
): Promise<CreateShipmentResult> {
  console.log(`Creating shipment for picklist ${picklistId}...`)

  try {
    // Fetch picklist details to get shipping provider and weight
    const picklist = await fetchPicklist(picklistId)
    console.log(`Picklist ${picklistId}: status=${picklist.status}, idshippingprovider_profile=${picklist.idshippingprovider_profile}, weight=${picklist.weight}`)

    // Verify picklist is in 'new' status (ready for shipment)
    if (picklist.status !== 'new') {
      console.error(`Picklist ${picklistId} is not in 'new' status (current: ${picklist.status})`)
      return {
        success: false,
        error: `Picklist status is '${picklist.status}', must be 'new' to create shipment`,
      }
    }

    // Use provided shipping provider, or fall back to picklist's provider
    let profileId = shippingProviderId || picklist.idshippingprovider_profile

    // If still no provider, fetch available methods
    if (!profileId) {
      console.log(`No shipping provider on picklist, fetching available methods...`)
      const methods = await getPicklistShippingMethods(picklistId)
      if (methods.length > 0) {
        profileId = methods[0].idshippingprovider_profile
        console.log(`Using first available shipping method: ${methods[0].name} (${profileId})`)
      } else {
        return {
          success: false,
          error: 'No shipping methods available for this picklist',
        }
      }
    }

    // Build request body - Picqer requires idshippingprofile and weight
    const body: Record<string, unknown> = {
      idshippingprofile: profileId,
    }

    // Add weight: prefer override, then picklist weight
    if (weightOverride) {
      body.weight = weightOverride
    } else if (picklist.weight) {
      body.weight = picklist.weight
    }

    // Add packaging if provided
    if (packagingId) {
      body.idpackaging = packagingId
    }

    console.log(`Shipment request body:`, JSON.stringify(body))

    // Use ?return=shipment to get the shipment object directly in the response
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/shipments?return=shipment`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error creating shipment for picklist ${picklistId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to create shipment: ${response.status} - ${errorText}`,
      }
    }

    // With ?return=shipment, Picqer returns the shipment object directly
    const shipmentResponse = await response.json()
    console.log(`Shipment response for picklist ${picklistId}:`, JSON.stringify(shipmentResponse).slice(0, 1000))

    // Check if we got a valid shipment
    if (!shipmentResponse.idshipment) {
      console.error(`No shipment ID in response for picklist ${picklistId}`)
      return {
        success: false,
        error: 'Shipment created but no shipment ID in response',
      }
    }

    const shipment: PicqerShipment = shipmentResponse

    console.log(`Shipment created: ${shipment.idshipment} (tracking: ${shipment.trackingcode})`)

    return {
      success: true,
      shipment,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error creating shipment for picklist ${picklistId}:`, errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Get the shipping label PDF for a shipment
 * Uses the labelurl_pdf from the shipment response to download directly
 * Returns the raw PDF data as a Buffer
 */
export async function getShipmentLabel(shipmentId: number, labelUrl?: string): Promise<GetLabelResult> {
  console.log(`Fetching label for shipment ${shipmentId}...`)

  try {
    // If we have a direct label URL, use it (faster and more reliable)
    if (labelUrl) {
      console.log(`Downloading label from URL: ${labelUrl}`)
      const response = await fetch(labelUrl)

      if (!response.ok) {
        console.error(`Error downloading label from URL: ${response.status}`)
        return {
          success: false,
          error: `Failed to download label: ${response.status}`,
        }
      }

      const contentType = response.headers.get('content-type') || 'application/pdf'
      const arrayBuffer = await response.arrayBuffer()
      const labelData = Buffer.from(arrayBuffer)

      console.log(`Label downloaded for shipment ${shipmentId}: ${labelData.length} bytes`)

      return {
        success: true,
        labelData,
        contentType,
      }
    }

    // Fallback to Picqer API endpoint (less reliable)
    console.log(`No label URL provided, trying Picqer API endpoint...`)
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/shipments/${shipmentId}/label`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error fetching label for shipment ${shipmentId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to fetch label: ${response.status} - ${errorText}`,
      }
    }

    const contentType = response.headers.get('content-type') || 'application/pdf'
    const arrayBuffer = await response.arrayBuffer()
    const labelData = Buffer.from(arrayBuffer)

    console.log(`Label fetched for shipment ${shipmentId}: ${labelData.length} bytes`)

    return {
      success: true,
      labelData,
      contentType,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error fetching label for shipment ${shipmentId}:`, errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

// ── Shipment read & cancel operations ────────────────────────────────────

/**
 * Get a single shipment by ID
 */
export async function getShipment(shipmentId: number): Promise<PicqerShipment> {
  console.log(`Fetching shipment ${shipmentId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/shipments/${shipmentId}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch shipment ${shipmentId}: ${response.status} - ${errorText}`)
  }

  return response.json()
}

/**
 * Get all shipments for a picklist
 */
export async function getPicklistShipments(picklistId: number): Promise<PicqerShipment[]> {
  console.log(`Fetching shipments for picklist ${picklistId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/${picklistId}/shipments`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to fetch shipments for picklist ${picklistId}: ${response.status} - ${errorText}`)
  }

  const shipments: PicqerShipment[] = await response.json()
  console.log(`Found ${shipments.length} shipments for picklist ${picklistId}`)
  return shipments
}

/**
 * Cancel a shipment (only possible within 5 minutes after creation)
 * Note: Picqer does NOT communicate cancellation to the carrier
 */
export async function cancelShipment(picklistId: number, shipmentId: number): Promise<CancelShipmentResult> {
  console.log(`Cancelling shipment ${shipmentId} on picklist ${picklistId}...`)

  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/shipments/${shipmentId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error cancelling shipment ${shipmentId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to cancel shipment: ${response.status} - ${errorText}`,
      }
    }

    console.log(`Shipment ${shipmentId} cancelled successfully`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error cancelling shipment ${shipmentId}:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Create a multicollo shipment (multiple parcels in one shipment)
 * All parcels must have the same packaging and weight per Picqer's requirements.
 * Each parcel gets its own tracking code.
 */
export async function createMulticolloShipment(
  picklistId: number,
  shippingProviderId: number,
  parcels: MulticolloParcelInput[],
): Promise<CreateShipmentResult> {
  console.log(`Creating multicollo shipment for picklist ${picklistId} with ${parcels.length} parcels...`)

  try {
    const body: Record<string, unknown> = {
      idshippingprofile: shippingProviderId,
      parcels,
    }

    console.log(`Multicollo request body:`, JSON.stringify(body))

    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/shipments?return=shipment`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error creating multicollo shipment for picklist ${picklistId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to create multicollo shipment: ${response.status} - ${errorText}`,
      }
    }

    const shipment: PicqerShipment = await response.json()

    if (!shipment.idshipment) {
      return {
        success: false,
        error: 'Multicollo shipment created but no shipment ID in response',
      }
    }

    console.log(`Multicollo shipment created: ${shipment.idshipment} with ${shipment.parcels?.length ?? 0} parcels`)

    return { success: true, shipment }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error creating multicollo shipment for picklist ${picklistId}:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Close a picklist manually
 * Picklists are normally closed automatically when a shipment is created and all products are picked,
 * but this method ensures explicit closure for reliability.
 */
export async function closePicklist(picklistId: number): Promise<{ success: boolean; error?: string }> {
  console.log(`Closing picklist ${picklistId}...`)

  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/close`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error closing picklist ${picklistId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to close picklist: ${response.status} - ${errorText}`,
      }
    }

    console.log(`Picklist ${picklistId} closed successfully`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error closing picklist ${picklistId}:`, errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Pick all products on a picklist
 * This marks all products as picked, which is required before closing the picklist.
 */
export async function pickAllProducts(picklistId: number): Promise<{ success: boolean; error?: string }> {
  console.log(`Picking all products on picklist ${picklistId}...`)

  try {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/picklists/${picklistId}/pickall`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error picking all on picklist ${picklistId}:`, response.status, errorText)
      return {
        success: false,
        error: `Failed to pick all: ${response.status} - ${errorText}`,
      }
    }

    console.log(`Picklist ${picklistId} all products picked successfully`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error picking all on picklist ${picklistId}:`, errorMessage)
    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Fetch all active users from Picqer with pagination
 */
export async function getUsers(): Promise<PicqerUser[]> {
  const allUsers: PicqerUser[] = []
  let offset = 0
  const limit = 100

  console.log('Fetching active users from Picqer...')

  while (true) {
    const params = new URLSearchParams({
      active: 'true',
      offset: offset.toString(),
    })

    const response = await rateLimitedFetch(`${PICQER_BASE_URL}/users?${params}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching users:', response.status, errorText)
      throw new Error(`Picqer API error: ${response.status}`)
    }

    const users: PicqerUser[] = await response.json()
    allUsers.push(...users)

    console.log(`Fetched ${users.length} users (total: ${allUsers.length})`)

    if (users.length < limit) {
      break
    }

    offset += limit

    // Safety limit: max 1000 users
    if (offset >= 1000) {
      console.log('Reached safety limit of 1000 users')
      break
    }
  }

  console.log(`Total active users fetched: ${allUsers.length}`)
  return allUsers
}

/**
 * Fetch picklists from Picqer with optional filters and pagination
 */
export async function getPicklists(params?: { status?: string; picklistid?: string; idpicklist_batch?: number; maxResults?: number }): Promise<PicqerPicklist[]> {
  const allPicklists: PicqerPicklist[] = []
  let offset = 0
  const limit = 100
  const maxResults = params?.maxResults

  console.log('Fetching picklists from Picqer...', params)

  while (true) {
    const queryParams = new URLSearchParams({
      offset: offset.toString(),
    })

    if (params?.status) {
      queryParams.set('status', params.status)
    }
    if (params?.picklistid) {
      queryParams.set('picklistid', params.picklistid)
    }
    if (params?.idpicklist_batch !== undefined) {
      queryParams.set('idpicklist_batch', params.idpicklist_batch.toString())
    }

    const response = await rateLimitedFetch(`${PICQER_BASE_URL}/picklists?${queryParams}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching picklists:', response.status, errorText)
      throw new Error(`Picqer API error: ${response.status}`)
    }

    const picklists: PicqerPicklist[] = await response.json()
    allPicklists.push(...picklists)

    console.log(`Fetched ${picklists.length} picklists (total: ${allPicklists.length})`)

    if (picklists.length < limit) {
      break
    }

    // Stop if we've reached the requested max
    if (maxResults && allPicklists.length >= maxResults) {
      break
    }

    offset += limit

    // Safety limit: max 3000 picklists
    if (offset >= 3000) {
      console.log('Reached safety limit of 3000 picklists')
      break
    }
  }

  console.log(`Total picklists fetched: ${allPicklists.length}`)
  return allPicklists
}

/**
 * Assign a picklist to a user
 */
export async function assignPicklist(picklistId: number, userId: number): Promise<PicqerPicklist> {
  console.log(`Assigning picklist ${picklistId} to user ${userId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/${picklistId}/assign`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ iduser: userId }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error assigning picklist ${picklistId}:`, response.status, errorText)
    throw new Error(`Failed to assign picklist: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  console.log(`Picklist ${picklistId} assigned to user ${userId} successfully`)
  return result
}

/**
 * Pick a specific product on a picklist.
 * Uses idpicklist_product (the line-item ID on the picklist), not the global product ID.
 */
export async function pickProduct(picklistId: number, idpicklistProduct: number, amount: number): Promise<PicqerPicklistWithProducts> {
  console.log(`Picking picklist product ${idpicklistProduct} (amount: ${amount}) on picklist ${picklistId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/${picklistId}/pick`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idpicklist_product: idpicklistProduct, amount }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error picking product on picklist ${picklistId}:`, response.status, errorText)
    throw new Error(`Failed to pick product: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  console.log(`Picklist product ${idpicklistProduct} picked on picklist ${picklistId} successfully`)
  return result
}

// ── Picklist Batch operations ──────────────────────────────────────────────

/**
 * Fetch picklist batches from Picqer with optional filters and pagination
 */
export async function getPicklistBatches(params?: { status?: string; type?: string; assigned_to_iduser?: number; maxResults?: number }): Promise<PicqerPicklistBatch[]> {
  const allBatches: PicqerPicklistBatch[] = []
  let offset = 0
  const limit = 100
  const maxResults = params?.maxResults

  console.log('Fetching picklist batches from Picqer...', params)

  while (true) {
    const queryParams = new URLSearchParams({
      offset: offset.toString(),
    })

    if (params?.status) {
      queryParams.set('status', params.status)
    }
    if (params?.type) {
      queryParams.set('type', params.type)
    }
    if (params?.assigned_to_iduser !== undefined) {
      queryParams.set('assigned_to_iduser', params.assigned_to_iduser.toString())
    }

    const response = await rateLimitedFetch(`${PICQER_BASE_URL}/picklists/batches?${queryParams}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Picqer API error fetching picklist batches:', response.status, errorText)
      throw new Error(`Picqer API error: ${response.status}`)
    }

    const batches: PicqerPicklistBatch[] = await response.json()
    allBatches.push(...batches)

    console.log(`Fetched ${batches.length} batches (total: ${allBatches.length})`)

    if (batches.length < limit) {
      break
    }

    if (maxResults && allBatches.length >= maxResults) {
      break
    }

    offset += limit

    if (offset >= 3000) {
      console.log('Reached safety limit of 3000 batches')
      break
    }
  }

  const result = maxResults ? allBatches.slice(0, maxResults) : allBatches
  console.log(`Total picklist batches fetched: ${result.length}`)
  return result
}

/**
 * Fetch a single picklist batch by ID
 */
export async function getPicklistBatch(batchId: number): Promise<PicqerPicklistBatch> {
  console.log(`Fetching picklist batch ${batchId} from Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/picklists/batches/${batchId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching batch ${batchId}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Assign a picklist batch to a user
 */
export async function assignPicklistBatch(batchId: number, userId: number): Promise<PicqerPicklistBatch> {
  console.log(`Assigning picklist batch ${batchId} to user ${userId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/batches/${batchId}/assign`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ iduser: userId }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error assigning batch ${batchId}:`, response.status, errorText)
    throw new Error(`Failed to assign batch: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  console.log(`Batch ${batchId} assigned to user ${userId} successfully`)
  return result
}

/**
 * Get PDF for a picklist batch (packing slips / pick list)
 * Returns raw PDF data as a Buffer
 */
export async function getPicklistBatchPdf(
  batchId: number,
  options?: { includePicklists?: boolean; includePackinglists?: boolean }
): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  console.log(`Fetching PDF for batch ${batchId}...`)

  try {
    const queryParams = new URLSearchParams()
    if (options?.includePicklists) queryParams.set('includePicklists', 'true')
    if (options?.includePackinglists) queryParams.set('includePackinglists', 'true')

    const queryString = queryParams.toString()
    const url = `${PICQER_BASE_URL}/picklists/batches/${batchId}/pdf${queryString ? `?${queryString}` : ''}`

    const response = await rateLimitedFetch(url, {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Picqer API error fetching batch PDF ${batchId}:`, response.status, errorText)
      return { success: false, error: `Failed to fetch batch PDF: ${response.status}` }
    }

    const arrayBuffer = await response.arrayBuffer()
    const data = Buffer.from(arrayBuffer)
    console.log(`Batch PDF fetched: ${data.length} bytes`)

    return { success: true, data }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error fetching batch PDF ${batchId}:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

/**
 * Add a picklist to an existing batch
 */
export async function addPicklistToBatch(batchId: number, picklistId: number): Promise<PicqerPicklistBatch> {
  console.log(`Adding picklist ${picklistId} to batch ${batchId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/batches/${batchId}/picklists`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idpicklist: picklistId }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error adding picklist to batch ${batchId}:`, response.status, errorText)
    throw new Error(`Failed to add picklist to batch: ${response.status} - ${errorText}`)
  }

  const result = await response.json()
  console.log(`Picklist ${picklistId} added to batch ${batchId} successfully`)
  return result
}

/**
 * Remove a picklist from a batch
 */
export async function removePicklistFromBatch(batchId: number, picklistId: number): Promise<void> {
  console.log(`Removing picklist ${picklistId} from batch ${batchId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/batches/${batchId}/picklists/${picklistId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error removing picklist from batch ${batchId}:`, response.status, errorText)
    throw new Error(`Failed to remove picklist from batch: ${response.status} - ${errorText}`)
  }

  console.log(`Picklist ${picklistId} removed from batch ${batchId} successfully`)
}

/**
 * Get picklists for a specific product within a batch
 */
export async function getProductPicklistsInBatch(batchId: number, productId: number): Promise<PicqerBatchPicklist[]> {
  console.log(`Fetching picklists for product ${productId} in batch ${batchId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/batches/${batchId}/products/${productId}/picklists`,
    {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching product picklists in batch ${batchId}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Delete a picklist batch in Picqer
 */
export async function deletePicklistBatch(batchId: number): Promise<void> {
  console.log(`Deleting picklist batch ${batchId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/picklists/batches/${batchId}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error deleting batch ${batchId}:`, response.status, errorText)
    throw new Error(`Failed to delete batch: ${response.status} - ${errorText}`)
  }

  console.log(`Batch ${batchId} deleted successfully`)
}

// ── Order operations ──────────────────────────────────────────────────────

/**
 * Fetch a single order by ID
 */
export async function fetchOrder(orderId: number): Promise<PicqerOrder> {
  console.log(`Fetching order ${orderId} from Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders/${orderId}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching order ${orderId}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

// ── Packing List PDF ──────────────────────────────────────────────────────

/**
 * Get packing list PDF for one or more picklists
 * Returns raw PDF data as a Buffer
 */
export async function getPackingListPdf(
  picklistIds: number[],
  _showAliases?: boolean
): Promise<{ success: boolean; data?: Buffer; error?: string }> {
  const { PDFDocument } = await import('pdf-lib')

  console.log(`Fetching packing list PDFs for ${picklistIds.length} picklists...`)

  try {
    const mergedPdf = await PDFDocument.create()

    for (const id of picklistIds) {
      const response = await rateLimitedFetch(
        `${PICQER_BASE_URL}/picklists/${id}/packinglistpdf`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
            'User-Agent': 'EveryPlants-Batchmaker/2.0',
          },
        }
      )

      if (!response.ok) {
        console.warn(`Skipping packing list PDF for picklist ${id}: ${response.status}`)
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const pdf = await PDFDocument.load(arrayBuffer)
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
      for (const page of pages) {
        mergedPdf.addPage(page)
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      return { success: false, error: 'Geen pakbonnen gevonden' }
    }

    const data = Buffer.from(await mergedPdf.save())
    console.log(`Merged packing list PDF: ${data.length} bytes, ${mergedPdf.getPageCount()} pages`)

    return { success: true, data }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`Error fetching packing list PDFs:`, errorMessage)
    return { success: false, error: errorMessage }
  }
}

// ── Comments API ───────────────────────────────────────────────────────────

export interface PicqerComment {
  idcomment: number
  body: string
  author_type: string
  author: {
    iduser: number
    username: string
    full_name: string
    image_url: string | null
  }
  created_at: string
  updated_at: string
}

/**
 * Get comments for a picklist or picklist batch
 */
export async function getComments(
  resourceType: 'picklists' | 'picklists/batches',
  resourceId: number
): Promise<PicqerComment[]> {
  console.log(`Fetching comments for ${resourceType}/${resourceId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/${resourceType}/${resourceId}/comments`,
    {
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching comments for ${resourceType}/${resourceId}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Add a comment to a picklist or picklist batch
 */
export async function addComment(
  resourceType: 'picklists' | 'picklists/batches',
  resourceId: number,
  body: string
): Promise<PicqerComment> {
  console.log(`Adding comment to ${resourceType}/${resourceId}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/${resourceType}/${resourceId}/comments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error adding comment to ${resourceType}/${resourceId}:`, response.status, errorText)
    throw new Error(`Failed to add comment: ${response.status} - ${errorText}`)
  }

  return response.json()
}

// ── Authenticated user ───────────────────────────────────────────────────

/**
 * Get the currently authenticated Picqer API user (the user behind the API key)
 */
export async function getMe(): Promise<PicqerUser> {
  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/me`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error fetching /me:', response.status, errorText)
    throw new Error(`Failed to fetch authenticated user: ${response.status} - ${errorText}`)
  }

  return response.json()
}

// ── Tag write operations ──────────────────────────────────────────────────

/**
 * Create a new tag in Picqer
 */
export async function createTag(
  title: string,
  color: string = '#0000f0',
  inherit: boolean = false
): Promise<PicqerTag> {
  console.log(`Creating tag "${title}" in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/tags`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, color, inherit }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error creating tag:`, response.status, errorText)
    throw new Error(`Failed to create tag: ${response.status} - ${errorText}`)
  }

  const tag: PicqerTag = await response.json()
  console.log(`Tag created: ${tag.idtag} - "${tag.title}"`)
  return tag
}

/**
 * Update a tag in Picqer
 */
export async function updateTag(
  idtag: number,
  updates: Partial<Pick<PicqerTag, 'title' | 'color' | 'inherit'>>
): Promise<PicqerTag> {
  console.log(`Updating tag ${idtag} in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/tags/${idtag}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error updating tag ${idtag}:`, response.status, errorText)
    throw new Error(`Failed to update tag: ${response.status} - ${errorText}`)
  }

  return response.json()
}

/**
 * Delete a tag in Picqer
 */
export async function deleteTag(idtag: number): Promise<void> {
  console.log(`Deleting tag ${idtag} in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/tags/${idtag}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error deleting tag ${idtag}:`, response.status, errorText)
    throw new Error(`Failed to delete tag: ${response.status} - ${errorText}`)
  }

  console.log(`Tag ${idtag} deleted successfully`)
}

// ── Packaging write operations ────────────────────────────────────────────

/**
 * Create a new packaging in Picqer
 */
export async function createPackaging(input: {
  name: string
  barcode?: string
  length?: number
  width?: number
  height?: number
}): Promise<PicqerPackaging> {
  console.log(`Creating packaging "${input.name}" in Picqer...`)

  const body: Record<string, unknown> = { name: input.name }
  if (input.barcode) body.barcode = input.barcode
  if (input.length) body.length = input.length
  if (input.width) body.width = input.width
  if (input.height) body.height = input.height

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/packagings`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error creating packaging:`, response.status, errorText)
    throw new Error(`Failed to create packaging: ${response.status} - ${errorText}`)
  }

  const packaging: PicqerPackaging = await response.json()
  console.log(`Packaging created: ${packaging.idpackaging} - "${packaging.name}"`)
  return packaging
}

/**
 * Update a packaging in Picqer
 */
export async function updatePackaging(
  idpackaging: number,
  updates: Partial<Pick<PicqerPackaging, 'name' | 'barcode' | 'length' | 'width' | 'height'>>
): Promise<PicqerPackaging> {
  console.log(`Updating packaging ${idpackaging} in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/packagings/${idpackaging}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error updating packaging ${idpackaging}:`, response.status, errorText)
    throw new Error(`Failed to update packaging: ${response.status} - ${errorText}`)
  }

  return response.json()
}

/**
 * Deactivate a packaging in Picqer (no DELETE endpoint available)
 */
export async function deactivatePackaging(idpackaging: number): Promise<PicqerPackaging> {
  console.log(`Deactivating packaging ${idpackaging} in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/packagings/${idpackaging}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ active: false }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error deactivating packaging ${idpackaging}:`, response.status, errorText)
    throw new Error(`Failed to deactivate packaging: ${response.status} - ${errorText}`)
  }

  return response.json()
}

/**
 * Delete a comment
 */
export async function deleteComment(idcomment: number): Promise<void> {
  console.log(`Deleting comment ${idcomment}...`)

  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/comments/${idcomment}`,
    {
      method: 'DELETE',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error deleting comment ${idcomment}:`, response.status, errorText)
    throw new Error(`Failed to delete comment: ${response.status} - ${errorText}`)
  }
}

// ── Product full details & composition parts ──────────────────────────────

/**
 * Get a single product with full details including custom fields
 */
export async function getProductFull(idproduct: number): Promise<PicqerProductFull> {
  console.log(`Fetching full product details for ${idproduct}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products/${idproduct}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching product ${idproduct}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}

/**
 * Get a product by productcode (exact match)
 * Returns first result or null if not found
 */
export async function getProductByCode(productcode: string): Promise<PicqerProductFull | null> {
  console.log(`Fetching product by code "${productcode}"...`)

  const params = new URLSearchParams({
    productcode: productcode,
  })

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products?${params}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching product by code "${productcode}":`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  const products: PicqerProductFull[] = await response.json()
  return products.length > 0 ? products[0] : null
}

/**
 * Update product custom fields
 */
export async function updateProductFields(
  idproduct: number,
  productfields: { idproductfield: number; value: string }[]
): Promise<void> {
  console.log(`Updating product fields for product ${idproduct}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products/${idproduct}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productfields }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error updating product fields for ${idproduct}:`, response.status, errorText)
    throw new Error(`Failed to update product fields: ${response.status} - ${errorText}`)
  }

  console.log(`Product fields updated for product ${idproduct}`)
}

/**
 * Get composition parts for a product
 */
export async function getProductParts(idproduct: number): Promise<PicqerCompositionPart[]> {
  console.log(`Fetching composition parts for product ${idproduct}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products/${idproduct}/parts`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching parts for product ${idproduct}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  const parts: PicqerCompositionPart[] = await response.json()
  console.log(`Found ${parts.length} composition parts for product ${idproduct}`)
  return parts
}

// ── Order tag operations ──────────────────────────────────────────────────

/**
 * Get tags for an order
 */
export async function getOrderTags(orderId: number): Promise<PicqerTag[]> {
  console.log(`Fetching tags for order ${orderId}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders/${orderId}/tags`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error fetching tags for order ${orderId}:`, response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  const tags: PicqerTag[] = await response.json()
  console.log(`Found ${tags.length} tags for order ${orderId}`)
  return tags
}

/**
 * Add a tag to an order
 */
export async function addOrderTag(orderId: number, idtag: number): Promise<void> {
  console.log(`Adding tag ${idtag} to order ${orderId}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders/${orderId}/tags`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idtag }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error adding tag to order ${orderId}:`, response.status, errorText)
    throw new Error(`Failed to add tag to order: ${response.status} - ${errorText}`)
  }

  console.log(`Tag ${idtag} added to order ${orderId} successfully`)
}

/**
 * Remove a tag from an order
 */
export async function removeOrderTag(orderId: number, idtag: number): Promise<void> {
  console.log(`Removing tag ${idtag} from order ${orderId}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders/${orderId}/tags/${idtag}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error removing tag from order ${orderId}:`, response.status, errorText)
    throw new Error(`Failed to remove tag from order: ${response.status} - ${errorText}`)
  }

  console.log(`Tag ${idtag} removed from order ${orderId} successfully`)
}

// ── Bulk product fetching ─────────────────────────────────────────────────

/**
 * Get products with pagination and filters
 */
export async function getProductsBulk(params: {
  updatedSince?: string
  offset?: number
  limit?: number
}): Promise<PicqerProductFull[]> {
  const { updatedSince, offset = 0, limit = 100 } = params

  console.log(`Fetching products bulk (offset: ${offset}, limit: ${limit})...`)

  const queryParams = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString(),
  })

  if (updatedSince) {
    queryParams.set('updated_since', updatedSince)
  }

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products?${queryParams}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error fetching products bulk:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  const products: PicqerProductFull[] = await response.json()
  console.log(`Fetched ${products.length} products (offset: ${offset})`)
  return products
}

// ── Customer operations ──────────────────────────────────────────────────

/**
 * Search customers by name
 */
export async function searchCustomers(query: string): Promise<PicqerCustomer[]> {
  console.log(`Searching customers for "${query}"...`)

  const params = new URLSearchParams({ search: query })

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/customers?${params}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error searching customers:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  const customers: PicqerCustomer[] = await response.json()
  console.log(`Found ${customers.length} customers for "${query}"`)
  return customers
}

/**
 * Create a new customer in Picqer
 */
export async function createCustomer(input: {
  name: string
  address?: string
  zipcode?: string
  city?: string
  country?: string
  language?: string
}): Promise<PicqerCustomer> {
  console.log(`Creating customer "${input.name}" in Picqer...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/customers`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error creating customer:', response.status, errorText)
    throw new Error(`Failed to create customer: ${response.status} - ${errorText}`)
  }

  const customer: PicqerCustomer = await response.json()
  console.log(`Customer created: ${customer.idcustomer} - "${customer.name}"`)
  return customer
}

// ── Order creation ──────────────────────────────────────────────────────

/**
 * Create a new order in Picqer
 */
export async function createOrder(input: CreateOrderInput): Promise<PicqerOrder> {
  console.log(`Creating order for customer ${input.idcustomer}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error creating order:', response.status, errorText)
    throw new Error(`Failed to create order: ${response.status} - ${errorText}`)
  }

  const order: PicqerOrder = await response.json()
  console.log(`Order created: ${order.idorder} (${order.orderid})`)
  return order
}

export async function updateOrderFields(
  idorder: number,
  fields: Array<{ idorderfield: number; value: string }>
): Promise<void> {
  // Picqer requires one call per orderfield: PUT /orders/{id}/orderfields/{idorderfield}
  for (const field of fields) {
    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/orders/${idorder}/orderfields/${field.idorderfield}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: field.value }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to update orderfield ${field.idorderfield} for order ${idorder}: ${response.status} - ${errorText}`)
    }
  }
}

/**
 * Process an order (move from concept to processing, creates picklist)
 */
export async function processOrder(orderId: number): Promise<PicqerOrder> {
  console.log(`Processing order ${orderId}...`)

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/orders/${orderId}/process`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error(`Picqer API error processing order ${orderId}:`, response.status, errorText)
    throw new Error(`Failed to process order: ${response.status} - ${errorText}`)
  }

  const order: PicqerOrder = await response.json()
  console.log(`Order ${orderId} processed → ${order.status}`)
  return order
}

/**
 * Haal stock op voor een product in een specifiek warehouse.
 * Retourneert locaties met type, zodat PPS-locaties gefilterd kunnen worden.
 */
export async function getProductStock(
  idproduct: number,
  idwarehouse: number
): Promise<PicqerProductStock> {
  const response = await rateLimitedFetch(
    `${PICQER_BASE_URL}/products/${idproduct}/stock/${idwarehouse}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
        'User-Agent': 'EveryPlants-Batchmaker/2.0',
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Picqer stock API error for product ${idproduct}: ${response.status} - ${errorText}`)
  }

  return response.json()
}

/**
 * Haal inkooporders op uit Picqer.
 * Standaard filter: status=purchased (besteld, nog niet ontvangen).
 */
export async function getPurchaseOrders(
  status?: 'concept' | 'purchased' | 'received' | 'cancelled'
): Promise<PicqerPurchaseOrder[]> {
  const params = new URLSearchParams()
  if (status) params.set('status', status)

  const allOrders: PicqerPurchaseOrder[] = []
  let offset = 0
  const limit = 100

  while (true) {
    params.set('offset', String(offset))

    const response = await rateLimitedFetch(
      `${PICQER_BASE_URL}/purchaseorders?${params}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-Batchmaker/2.0',
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Picqer purchaseorders API error: ${response.status} - ${errorText}`)
    }

    const batch: PicqerPurchaseOrder[] = await response.json()
    allOrders.push(...batch)

    if (batch.length < limit) break
    offset += limit
  }

  return allOrders
}

/**
 * Search products by custom field value (e.g. Alternatieve SKU)
 * Uses Picqer's search which searches across productcode, barcode, and custom fields
 */
export async function searchProducts(query: string): Promise<PicqerProductFull[]> {
  console.log(`Searching products for "${query}"...`)

  const params = new URLSearchParams({ search: query })

  const response = await rateLimitedFetch(`${PICQER_BASE_URL}/products?${params}`, {
    headers: {
      'Authorization': `Basic ${Buffer.from(PICQER_API_KEY + ':').toString('base64')}`,
      'User-Agent': 'EveryPlants-Batchmaker/2.0',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Picqer API error searching products:', response.status, errorText)
    throw new Error(`Picqer API error: ${response.status}`)
  }

  return response.json()
}
