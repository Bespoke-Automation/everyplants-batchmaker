/**
 * Shopify Admin API client — multi-store with per-retailer credentials.
 *
 * Config lives in batchmaker.shopify_stores. Tokens live in env vars (prefix + _ADMIN_TOKEN).
 * The only reason this exists is to patch a Picqer→Shopify sync limitation where
 * only the first shipment per picklist gets pushed as a fulfillment tracking code.
 */

import { supabase } from '@/lib/supabase/client'

export interface ShopifyStoreConfig {
  retailer_tag: string
  store_domain: string
  env_var_prefix: string
  api_version: string
  enabled: boolean
  tracking_sync_enabled: boolean
  carrier_override: string | null
}

export interface ShopifyFulfillment {
  id: number
  order_id: number
  status: string
  tracking_company: string | null
  tracking_numbers: string[]
  tracking_urls: string[]
  location_id: number | null
  line_items: Array<{ id: number; title: string; quantity: number }>
  created_at: string
}

export interface ShopifyOrder {
  id: number
  name: string
  fulfillments: ShopifyFulfillment[]
}

export interface ShopifyFulfillmentOrder {
  id: number
  status: string
  request_status?: string
  assigned_location_id: number | null
  assigned_location?: {
    location_id?: number | null
    name?: string | null
  }
}

/**
 * Picqer's Shopify fulfillment service appears under one of these location names.
 * We accept both spellings because Shopify location names are user-editable and
 * historically Picqer has used "Fulfilment" (British) but users may rename.
 *
 * Match is case-insensitive. If your shop uses a different name, add it here OR
 * set the location id directly in shopify_stores.picqer_location_id (future).
 */
export const PICQER_LOCATION_NAMES = ['picqer fulfilment', 'picqer fulfillment']

export interface ResolvedStore {
  config: ShopifyStoreConfig
  storeDomain: string
  adminToken: string
  apiVersion: string
}

export class ShopifyConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShopifyConfigError'
  }
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message)
    this.name = 'ShopifyApiError'
  }
}

/**
 * Resolve a store config from the DB and hydrate with credentials from env vars.
 * Returns null when retailer is not configured, disabled, or tracking sync is off —
 * caller should treat these as "skip silently".
 */
export async function resolveStoreForRetailer(
  retailerTag: string,
): Promise<ResolvedStore | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shopify_stores')
    .select('*')
    .eq('retailer_tag', retailerTag)
    .maybeSingle()

  if (error) {
    throw new ShopifyConfigError(`Failed to load shopify_stores for ${retailerTag}: ${error.message}`)
  }
  if (!data) return null
  if (!data.enabled || !data.tracking_sync_enabled) return null

  const tokenVar = `${data.env_var_prefix}_ADMIN_TOKEN`
  const domainVar = `${data.env_var_prefix}_STORE_DOMAIN`
  const adminToken = process.env[tokenVar]
  const storeDomain = process.env[domainVar] || data.store_domain

  if (!adminToken) {
    throw new ShopifyConfigError(
      `Shopify store ${retailerTag} is enabled in DB but env var ${tokenVar} is missing`,
    )
  }

  return {
    config: data as ShopifyStoreConfig,
    storeDomain,
    adminToken,
    apiVersion: data.api_version,
  }
}

function baseUrl(store: ResolvedStore): string {
  return `https://${store.storeDomain}/admin/api/${store.apiVersion}`
}

function headers(store: ResolvedStore): HeadersInit {
  return {
    'X-Shopify-Access-Token': store.adminToken,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

async function shopifyFetch(
  store: ResolvedStore,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = `${baseUrl(store)}${path}`
  const response = await fetch(url, {
    ...init,
    headers: { ...headers(store), ...(init.headers as Record<string, string> | undefined) },
  })

  // Honour Shopify's 2-req/sec leaky bucket if we get 429
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') || '2')
    await new Promise(r => setTimeout(r, retryAfter * 1000))
    return shopifyFetch(store, path, init)
  }

  return response
}

/**
 * Look up an order by its numeric Shopify order ID (bigint).
 * Picqer stores this value in orderfield 3333 ("Retailer Ordernummer").
 */
export async function getOrder(
  store: ResolvedStore,
  shopifyOrderId: number | string,
): Promise<ShopifyOrder | null> {
  const response = await shopifyFetch(store, `/orders/${shopifyOrderId}.json`)
  if (response.status === 404) return null
  if (!response.ok) {
    const body = await response.text()
    throw new ShopifyApiError(
      `Failed to fetch Shopify order ${shopifyOrderId}: ${response.status}`,
      response.status,
      body,
    )
  }
  const data = await response.json()
  return data.order as ShopifyOrder
}

/**
 * Fetch fulfillment_orders for an order. We need this because the regular order
 * endpoint does NOT expose `assigned_location.name` — and that name (e.g. "Picqer
 * Fulfilment") is the only authoritative way to know which fulfillment service
 * an order is routed through. Critical guard against accidentally patching
 * fulfillments that belong to a different fulfillment service (e.g. Everspring).
 */
export async function getFulfillmentOrders(
  store: ResolvedStore,
  shopifyOrderId: number | string,
): Promise<ShopifyFulfillmentOrder[]> {
  const response = await shopifyFetch(store, `/orders/${shopifyOrderId}/fulfillment_orders.json`)
  if (response.status === 404) return []
  if (!response.ok) {
    const body = await response.text()
    throw new ShopifyApiError(
      `Failed to fetch fulfillment_orders for ${shopifyOrderId}: ${response.status}`,
      response.status,
      body,
    )
  }
  const data = (await response.json()) as { fulfillment_orders?: ShopifyFulfillmentOrder[] }
  return data.fulfillment_orders ?? []
}

/**
 * Resolve the Picqer-fulfilment location id for a given order. Returns null if
 * the order is not (or not entirely) routed through Picqer's fulfillment service.
 * Use this to gate the tracking sync — we never patch fulfillments that don't
 * live at the Picqer location.
 */
export function extractPicqerLocationId(
  fulfillmentOrders: ShopifyFulfillmentOrder[],
): number | null {
  for (const fo of fulfillmentOrders) {
    const name = (fo.assigned_location?.name || '').trim().toLowerCase()
    if (PICQER_LOCATION_NAMES.includes(name)) {
      return fo.assigned_location_id ?? fo.assigned_location?.location_id ?? null
    }
  }
  return null
}

/**
 * Update tracking info on an existing fulfillment via the GraphQL Admin API.
 *
 * IMPORTANT: the REST `update_tracking.json` endpoint only supports a singular
 * `number`/`url` and silently wipes existing tracking when an unsupported `numbers`
 * array is sent. The GraphQL `fulfillmentTrackingInfoUpdate` mutation is the only
 * official way to set multiple tracking numbers on one fulfillment in 2025-01.
 *
 * Verified empirically against fulfillment 6014583374037 on 2026-04-10:
 *   REST  → tracking_numbers wiped to []
 *   GraphQL → tracking_numbers = ['...894', '...895']
 *
 * All numbers within one fulfillment must share the same carrier (`company`).
 */
export async function updateFulfillmentTracking(
  store: ResolvedStore,
  fulfillmentId: number,
  trackingInfo: { company: string; numbers: string[]; urls: string[] },
  notifyCustomer: boolean,
): Promise<{ id: string; trackingInfoCount: number }> {
  if (trackingInfo.numbers.length === 0) {
    throw new Error('updateFulfillmentTracking: refusing to call with empty numbers (would wipe tracking)')
  }
  if (trackingInfo.urls.length !== trackingInfo.numbers.length) {
    throw new Error('updateFulfillmentTracking: numbers and urls must be the same length')
  }

  const mutation = `
    mutation fulfillmentTrackingInfoUpdate(
      $fulfillmentId: ID!
      $trackingInfoInput: FulfillmentTrackingInput!
      $notifyCustomer: Boolean
    ) {
      fulfillmentTrackingInfoUpdate(
        fulfillmentId: $fulfillmentId
        trackingInfoInput: $trackingInfoInput
        notifyCustomer: $notifyCustomer
      ) {
        fulfillment {
          id
          trackingInfo { number url company }
        }
        userErrors { field message }
      }
    }
  `

  const variables = {
    fulfillmentId: `gid://shopify/Fulfillment/${fulfillmentId}`,
    trackingInfoInput: {
      company: trackingInfo.company,
      numbers: trackingInfo.numbers,
      urls: trackingInfo.urls,
    },
    notifyCustomer,
  }

  const response = await shopifyFetch(store, '/graphql.json', {
    method: 'POST',
    body: JSON.stringify({ query: mutation, variables }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new ShopifyApiError(
      `GraphQL fulfillmentTrackingInfoUpdate ${fulfillmentId}: ${response.status}`,
      response.status,
      body,
    )
  }

  const json = (await response.json()) as {
    data?: {
      fulfillmentTrackingInfoUpdate?: {
        fulfillment?: { id: string; trackingInfo: Array<{ number: string; url: string; company: string }> }
        userErrors?: Array<{ field: string[] | null; message: string }>
      }
    }
    errors?: Array<{ message: string }>
  }

  if (json.errors && json.errors.length > 0) {
    throw new ShopifyApiError(
      `GraphQL errors on fulfillmentTrackingInfoUpdate ${fulfillmentId}: ${json.errors.map(e => e.message).join('; ')}`,
      200,
      JSON.stringify(json.errors),
    )
  }

  const result = json.data?.fulfillmentTrackingInfoUpdate
  const userErrors = result?.userErrors ?? []
  if (userErrors.length > 0) {
    throw new ShopifyApiError(
      `userErrors on fulfillmentTrackingInfoUpdate ${fulfillmentId}: ${userErrors.map(e => `${(e.field || []).join('.')}: ${e.message}`).join('; ')}`,
      422,
      JSON.stringify(userErrors),
    )
  }

  if (!result?.fulfillment) {
    throw new ShopifyApiError(
      `fulfillmentTrackingInfoUpdate returned no fulfillment for ${fulfillmentId}`,
      500,
      JSON.stringify(json),
    )
  }

  return {
    id: result.fulfillment.id,
    trackingInfoCount: result.fulfillment.trackingInfo.length,
  }
}
