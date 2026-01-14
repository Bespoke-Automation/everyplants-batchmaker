import { PicqerOrder, PicqerPicklistWithProducts, PicqerProduct, PicqerShipment, CreateShipmentResult, GetLabelResult, PicqerPackaging, ShippingMethod } from './types'

const PICQER_SUBDOMAIN = process.env.PICQER_SUBDOMAIN!
const PICQER_API_KEY = process.env.PICQER_API_KEY!

const PICQER_BASE_URL = `https://${PICQER_SUBDOMAIN}.picqer.com/api/v1`

// Rate limiting configuration
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY_MS = 2000

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Make a rate-limited fetch request with retry logic for 429 errors
 */
async function rateLimitedFetch(url: string, options: RequestInit): Promise<Response> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, options)

    if (response.status === 429) {
      // Rate limited - check for Retry-After header or use exponential backoff
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
  packagingId?: number | null
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

    // Add weight if available
    if (picklist.weight) {
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
