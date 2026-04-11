import { PicqerOrder, PicqerTag, ORDERFIELD_IDS, EXCLUDED_TAGS } from './types'
import { TransformedOrder, OrderTag } from '@/types/order'
import { DAYS } from '@/constants'

// Retailer names that appear as tags
export const RETAILER_TAGS = [
  'Green Bubble',
  'Everspring',
  'Ogreen',
  'Florafy',
  'Trendyplants',
  'Plantura',
]

/**
 * Picqer tag IDs per retailer. Tag IDs are immutable in Picqer; tag names are
 * editable by users. ALWAYS prefer ID-based matching for routing/security
 * decisions; reserve name-based matching for display only.
 *
 * Verified against production Picqer (green-bubble) on 2026-04-11.
 */
export const RETAILER_TAG_IDS: Record<string, number> = {
  Florafy: 252017,
  // Trendyplants, Green Bubble, etc. — to be added when needed
}

/**
 * Extract retailer tag from a Picqer order's tags object (Record<string, PicqerTag>).
 * Returns the human-readable tag title. Used for logging and display.
 *
 * For routing decisions (like Shopify sync), prefer getRetailerTagIdFromOrder
 * because tag IDs are stable across renames.
 */
export function getRetailerTagFromOrder(order: PicqerOrder): string | null {
  const titles = Object.values(order.tags ?? {}).map(t => t.title)
  return titles.find(t => RETAILER_TAGS.includes(t)) ?? null
}

/**
 * Extract a retailer match from a Picqer order using tag IDs (not names).
 * Returns both the id and title so callers can route + log without re-querying.
 * Returns null when no recognised retailer tag id is present on the order.
 */
export function getRetailerByTagId(
  order: PicqerOrder,
  knownTagIds: Record<string, number>,
): { tagId: number; retailerTag: string } | null {
  const orderTagIds = Object.values(order.tags ?? {}).map(t => t.idtag)
  for (const [retailer, id] of Object.entries(knownTagIds)) {
    if (orderTagIds.includes(id)) {
      return { tagId: id, retailerTag: retailer }
    }
  }
  return null
}

/**
 * Get value from orderfields by field ID
 */
function getOrderfieldValue(order: PicqerOrder, fieldId: number): string | null {
  const field = order.orderfields?.find(f => f.idorderfield === fieldId)
  return field?.value || null
}

/**
 * Extract tag titles from tags object
 */
function extractTagTitles(tags: Record<string, PicqerTag> | undefined): string[] {
  if (!tags || typeof tags !== 'object') return []
  return Object.values(tags).map(tag => tag.title)
}

/**
 * Extract tag IDs from tags object
 */
function extractTagIds(tags: Record<string, PicqerTag> | undefined): number[] {
  if (!tags || typeof tags !== 'object') return []
  return Object.values(tags).map(tag => tag.idtag)
}

/**
 * Extract full tag objects with colors from tags object
 */
function extractTags(tags: Record<string, PicqerTag> | undefined): OrderTag[] {
  if (!tags || typeof tags !== 'object') return []
  return Object.values(tags).map(tag => ({
    title: tag.title,
    color: tag.color || '#e5e5e5',
    textColor: tag.textColor || '#000000',
  }))
}

/**
 * Extract retailer name from tags (retailers are stored as tags)
 */
function extractRetailerFromTags(tagTitles: string[]): string {
  const retailer = tagTitles.find(tag => RETAILER_TAGS.includes(tag))
  return retailer || '-'
}

/**
 * Check if order has any excluded tag
 */
function hasExcludedTag(tagTitles: string[]): boolean {
  return tagTitles.some(tag =>
    EXCLUDED_TAGS.includes(tag as typeof EXCLUDED_TAGS[number])
  )
}

/**
 * Normalize leverdag to consistent capitalization (e.g., "donderdag" -> "Donderdag")
 */
function normalizeLeverdag(leverdag: string | null): string {
  if (!leverdag) return 'Geen leverdag'
  return leverdag.charAt(0).toUpperCase() + leverdag.slice(1).toLowerCase()
}

/**
 * Check if order is fully part of a batch (no eligible picklist available)
 * Returns false if there's at least one picklist with status 'new' that's not in a batch
 */
function isPartOfBatch(order: PicqerOrder): boolean {
  // Check if there's an eligible picklist (new + not in batch)
  const hasEligiblePicklist = order.picklists?.some(
    p => p.status === 'new' && p.idpicklist_batch === null
  ) ?? false

  // If there's an eligible picklist, the order is NOT considered "part of a batch"
  return !hasEligiblePicklist
}

/**
 * Check if order has a picklist with status "new"
 */
function hasNewPicklist(order: PicqerOrder): boolean {
  return order.picklists?.some(p => p.status === 'new') ?? false
}

/**
 * Get the eligible picklist for batch creation:
 * - Status must be 'new'
 * - Must not already be in a batch
 * Falls back to first picklist if no eligible one found (for display purposes)
 */
function getEligiblePicklist(order: PicqerOrder) {
  // First, try to find a picklist that is 'new' AND not in a batch
  const eligiblePicklist = order.picklists?.find(
    p => p.status === 'new' && p.idpicklist_batch === null
  )
  if (eligiblePicklist) return eligiblePicklist

  // Fall back to any 'new' picklist (might already be in a batch)
  const newPicklist = order.picklists?.find(p => p.status === 'new')
  if (newPicklist) return newPicklist

  // Final fallback to first picklist (for display purposes only)
  return order.picklists?.[0]
}

/**
 * Transform a Picqer order to our app format
 */
export function transformOrder(order: PicqerOrder): TransformedOrder {
  const tagTitles = extractTagTitles(order.tags)
  const tagIds = extractTagIds(order.tags)
  const tags = extractTags(order.tags)
  const picklist = getEligiblePicklist(order)
  const plantnummer = getOrderfieldValue(order, ORDERFIELD_IDS.PLANTNUMMER)

  return {
    id: String(order.idorder),
    reference: order.reference || `#${order.orderid}`,
    retailerName: extractRetailerFromTags(tagTitles),
    tagTitles,
    tagIds,
    tags,
    bezorgland: order.deliverycountry || 'NL',
    leverdag: normalizeLeverdag(getOrderfieldValue(order, ORDERFIELD_IDS.LEVERDAG)),
    picklistId: picklist?.picklistid || '-',
    invoiceName: order.invoicename || order.deliveryname || '-',
    orderId: order.orderid,
    idOrder: String(order.idorder),
    plantnummer,
    hasPlantnummer: plantnummer !== null && plantnummer !== '',
    retailerOrderNumber: getOrderfieldValue(order, ORDERFIELD_IDS.RETAILER_ORDER_NUMBER),
    idCustomer: order.idcustomer ? String(order.idcustomer) : '-',
    idTemplate: String(order.idtemplate || '-'),
    idShipping: String(order.idshippingprovider_profile || '-'),
    totalProducts: picklist?.totalproducts || 0,
    preferredDeliveryDate: picklist?.preferred_delivery_date || null,
    created: order.created,
    // New fields for batch creation
    idPicklist: picklist?.idpicklist ?? null,
    picklistStatus: picklist?.status ?? null,
    isPartOfBatch: isPartOfBatch(order),
    deliveryPostalCode: order.deliveryzipcode ?? null,
    // Get shipping provider from picklist (preferred) or fall back to order level
    idShippingProvider: picklist?.idshippingprovider_profile ?? order.idshippingprovider_profile ?? null,
  }
}

/**
 * Filter orders that are eligible for batching
 * - NOT cancelled
 * - NOT part of a batch
 * - Has picklist with status "new"
 * - No excluded tags
 */
export function filterEligibleOrders(orders: PicqerOrder[]): PicqerOrder[] {
  return orders.filter(order => {
    // Must be processing (safety check - API should already filter these out)
    if (order.status !== 'processing') {
      return false
    }

    // Must NOT be part of a batch
    if (isPartOfBatch(order)) {
      return false
    }

    // Must have a picklist with status "new"
    if (!hasNewPicklist(order)) {
      return false
    }

    // Must NOT have any excluded tags
    const tagTitles = extractTagTitles(order.tags)
    if (hasExcludedTag(tagTitles)) {
      return false
    }

    return true
  })
}

/**
 * Extract unique values from orders for filter dropdowns
 */
export function extractMetadata(orders: TransformedOrder[]) {
  return {
    retailers: [...new Set(orders.map(o => o.retailerName).filter(r => r !== '-'))].sort(),
    tags: [...new Set(orders.flatMap(o => o.tagTitles))].sort(),
    countries: [...new Set(orders.map(o => o.bezorgland))].sort(),
    leverdagen: [...new Set(orders.map(o => o.leverdag))].sort((a, b) => {
      const al = a.toLowerCase()
      const bl = b.toLowerCase()
      const ai = DAYS.findIndex(d => d.toLowerCase() === al)
      const bi = DAYS.findIndex(d => d.toLowerCase() === bl)
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi)
    }),
  }
}
