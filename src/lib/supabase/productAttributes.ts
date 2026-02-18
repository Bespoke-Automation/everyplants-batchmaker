import { supabase } from './client'
import { getProductsBulk, getProductParts } from '@/lib/picqer/client'
import type { PicqerProductFull } from '@/lib/picqer/types'

// ── Environment: Custom Picqer product field IDs ─────────────────────────────

const PICQER_FIELD_POTMAAT = parseInt(process.env.PICQER_FIELD_POTMAAT || '5768', 10)
const PICQER_FIELD_PLANTHOOGTE = parseInt(process.env.PICQER_FIELD_PLANTHOOGTE || '5769', 10)
const PICQER_FIELD_PRODUCTTYPE = parseInt(process.env.PICQER_FIELD_PRODUCTTYPE || '5770', 10)
const PICQER_FIELD_BREEKBAAR = parseInt(process.env.PICQER_FIELD_BREEKBAAR || '5771', 10)
const PICQER_FIELD_MIXABLE = parseInt(process.env.PICQER_FIELD_MIXABLE || '5772', 10)

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProductAttribute {
  id: string
  picqer_product_id: number
  productcode: string
  product_name: string
  product_type: string
  picqer_product_type: string | null
  is_composition: boolean
  pot_size: number | null
  height: number | null
  weight: number | null
  is_fragile: boolean
  is_mixable: boolean
  shipping_unit_id: string | null
  classification_status: string
  source: string
  last_synced_at: string | null
  picqer_updated_at: string | null
  created_at: string
  updated_at: string
}

export interface ProductCompositionPart {
  id: string
  parent_product_id: number
  part_product_id: number
  amount: number
  part_shipping_unit_id: string | null
  last_synced_at: string | null
  created_at: string
}

export interface ShippingUnit {
  id: string
  name: string
  product_type: string
  pot_size_min: number | null
  pot_size_max: number | null
  height_min: number | null
  height_max: number | null
  is_fragile_filter: boolean | null
  is_active: boolean
  sort_order: number | null
}

export interface SyncStats {
  synced: number
  compositions: number
  errors: number
}

export interface ClassifyStats {
  classified: number
  no_match: number
  missing_data: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ParsedCustomFields {
  potmaat: number | null
  planthoogte: number | null
  producttype: string | null
  breekbaar: boolean
  mixable: boolean
}

/**
 * Extract custom field values from a Picqer product's productfields array
 */
export function parseCustomFields(product: PicqerProductFull): ParsedCustomFields {
  const fields = product.productfields || []

  const getFieldValue = (fieldId: number): string | undefined => {
    const field = fields.find(f => f.idproductfield === fieldId)
    return field?.value
  }

  const potmaatRaw = getFieldValue(PICQER_FIELD_POTMAAT)
  const planthoogteRaw = getFieldValue(PICQER_FIELD_PLANTHOOGTE)
  const producttypeRaw = getFieldValue(PICQER_FIELD_PRODUCTTYPE)
  const breekbaarRaw = getFieldValue(PICQER_FIELD_BREEKBAAR)
  const mixableRaw = getFieldValue(PICQER_FIELD_MIXABLE)

  const potmaat = potmaatRaw ? parseFloat(potmaatRaw) : null
  const planthoogte = planthoogteRaw ? parseFloat(planthoogteRaw) : null

  return {
    potmaat: potmaat !== null && !isNaN(potmaat) ? potmaat : null,
    planthoogte: planthoogte !== null && !isNaN(planthoogte) ? planthoogte : null,
    producttype: producttypeRaw || null,
    breekbaar: breekbaarRaw === 'Ja',
    mixable: mixableRaw !== 'Nee', // default to true
  }
}

// ── Single product sync ──────────────────────────────────────────────────────

/**
 * Upsert a single Picqer product into product_attributes
 */
export async function syncProductFromPicqer(product: PicqerProductFull): Promise<void> {
  const customFields = parseCustomFields(product)
  const isComposition = (product.type || '').includes('composition')

  const { error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .upsert(
      {
        picqer_product_id: product.idproduct,
        productcode: product.productcode,
        product_name: product.name,
        product_type: customFields.producttype || 'Onbekend',
        picqer_product_type: product.type || null,
        is_composition: isComposition,
        pot_size: customFields.potmaat,
        height: customFields.planthoogte,
        weight: product.weight ?? null,
        is_fragile: customFields.breekbaar,
        is_mixable: customFields.mixable,
        classification_status: 'unclassified',
        source: 'picqer_sync',
        last_synced_at: new Date().toISOString(),
        picqer_updated_at: product.updated || null,
      },
      { onConflict: 'picqer_product_id' }
    )

  if (error) {
    console.error(`Error syncing product ${product.idproduct} (${product.productcode}):`, error)
    throw error
  }
}

// ── Bulk sync ────────────────────────────────────────────────────────────────

/**
 * Sync all products from Picqer (with optional updatedSince filter) into product_attributes.
 * For composition products, also syncs composition parts.
 */
export async function syncProductsBulk(updatedSince?: string): Promise<SyncStats> {
  const stats: SyncStats = { synced: 0, compositions: 0, errors: 0 }
  let offset = 0
  const limit = 100

  console.log(`[product-sync] Starting bulk sync${updatedSince ? ` (updated since ${updatedSince})` : ''}...`)

  while (true) {
    const products = await getProductsBulk({ updatedSince, offset, limit })

    if (products.length === 0) break

    for (const product of products) {
      try {
        await syncProductFromPicqer(product)
        stats.synced++

        // Sync composition parts for composition products
        const isComposition = (product.type || '').includes('composition')
        if (isComposition) {
          try {
            const parts = await getProductParts(product.idproduct)
            await syncCompositionParts(product.idproduct, parts)
            stats.compositions++
          } catch (partsError) {
            console.error(`[product-sync] Error syncing parts for composition ${product.idproduct}:`, partsError)
            stats.errors++
          }
        }
      } catch (syncError) {
        console.error(`[product-sync] Error syncing product ${product.idproduct}:`, syncError)
        stats.errors++
      }
    }

    console.log(`[product-sync] Progress: ${stats.synced} synced, ${stats.compositions} compositions, ${stats.errors} errors (offset: ${offset})`)

    if (products.length < limit) break

    offset += limit

    // Safety limit: max 10000 products
    if (offset >= 10000) {
      console.log('[product-sync] Reached safety limit of 10000 products')
      break
    }
  }

  console.log(`[product-sync] Bulk sync complete: ${stats.synced} synced, ${stats.compositions} compositions, ${stats.errors} errors`)
  return stats
}

/**
 * Sync composition parts for a parent product
 */
export async function syncCompositionParts(
  parentProductId: number,
  parts: { idproduct: number; idproduct_part: number; amount: number }[]
): Promise<void> {
  // Delete existing parts for this parent, then re-insert
  const { error: deleteError } = await supabase
    .schema('batchmaker')
    .from('product_composition_parts')
    .delete()
    .eq('parent_product_id', parentProductId)

  if (deleteError) {
    console.error(`Error deleting existing parts for product ${parentProductId}:`, deleteError)
    throw deleteError
  }

  if (parts.length === 0) return

  const rows = parts.map(part => ({
    parent_product_id: parentProductId,
    part_product_id: part.idproduct_part,
    amount: part.amount,
    last_synced_at: new Date().toISOString(),
  }))

  const { error: insertError } = await supabase
    .schema('batchmaker')
    .from('product_composition_parts')
    .insert(rows)

  if (insertError) {
    console.error(`Error inserting parts for product ${parentProductId}:`, insertError)
    throw insertError
  }
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a single product by matching it against shipping_units.
 * Returns the shipping_unit_id if matched, or null.
 */
export async function classifyProduct(productId: number): Promise<string | null> {
  // Fetch the product from product_attributes
  const { data: product, error: fetchError } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select()
    .eq('picqer_product_id', productId)
    .single()

  if (fetchError) {
    console.error(`Error fetching product ${productId} for classification:`, fetchError)
    throw fetchError
  }

  // If missing both pot_size and height, mark as missing_data
  if (product.pot_size === null && product.height === null) {
    await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .update({ classification_status: 'missing_data' })
      .eq('picqer_product_id', productId)

    return null
  }

  // Fetch active shipping units filtered by product_type
  const { data: shippingUnits, error: unitsError } = await supabase
    .schema('batchmaker')
    .from('shipping_units')
    .select()
    .eq('is_active', true)
    .eq('product_type', product.product_type)
    .order('sort_order', { ascending: true })

  if (unitsError) {
    console.error(`Error fetching shipping units for product ${productId}:`, unitsError)
    throw unitsError
  }

  // Filter shipping units by criteria
  const matches = (shippingUnits || []).filter((unit: ShippingUnit) => {
    // pot_size range check (skip bounds if NULL in shipping_unit)
    if (unit.pot_size_min !== null && (product.pot_size === null || product.pot_size < unit.pot_size_min)) {
      return false
    }
    if (unit.pot_size_max !== null && (product.pot_size === null || product.pot_size > unit.pot_size_max)) {
      return false
    }

    // height range check (skip bounds if NULL in shipping_unit)
    if (unit.height_min !== null && (product.height === null || product.height < unit.height_min)) {
      return false
    }
    if (unit.height_max !== null && (product.height === null || product.height > unit.height_max)) {
      return false
    }

    // is_fragile_filter check (NULL = match all)
    if (unit.is_fragile_filter !== null && unit.is_fragile_filter !== product.is_fragile) {
      return false
    }

    return true
  })

  if (matches.length === 0) {
    // No match found
    await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .update({ classification_status: 'no_match' })
      .eq('picqer_product_id', productId)

    return null
  }

  // Pick the most specific match (smallest range)
  let bestMatch = matches[0]

  if (matches.length > 1) {
    bestMatch = matches.reduce((best: ShippingUnit, current: ShippingUnit) => {
      const bestRange = calculateRange(best)
      const currentRange = calculateRange(current)
      return currentRange < bestRange ? current : best
    })
  }

  // Update product with match
  const { error: updateError } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .update({
      shipping_unit_id: bestMatch.id,
      classification_status: 'classified',
    })
    .eq('picqer_product_id', productId)

  if (updateError) {
    console.error(`Error updating classification for product ${productId}:`, updateError)
    throw updateError
  }

  return bestMatch.id
}

/**
 * Calculate the "range" of a shipping unit (smaller = more specific)
 */
function calculateRange(unit: ShippingUnit): number {
  let range = 0

  const potRange = (unit.pot_size_max ?? 1000) - (unit.pot_size_min ?? 0)
  const heightRange = (unit.height_max ?? 1000) - (unit.height_min ?? 0)

  range = potRange + heightRange
  return range
}

/**
 * Classify all unclassified products
 */
export async function classifyAllProducts(): Promise<ClassifyStats> {
  const stats: ClassifyStats = { classified: 0, no_match: 0, missing_data: 0 }

  // Fetch all unclassified products
  const { data: products, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, pot_size, height')
    .eq('classification_status', 'unclassified')

  if (error) {
    console.error('Error fetching unclassified products:', error)
    throw error
  }

  if (!products || products.length === 0) {
    console.log('[product-classify] No unclassified products found')
    return stats
  }

  console.log(`[product-classify] Classifying ${products.length} unclassified products...`)

  for (const product of products) {
    try {
      const result = await classifyProduct(product.picqer_product_id)

      if (result) {
        stats.classified++
      } else {
        // Check if it was missing_data or no_match by re-reading
        const { data: updated } = await supabase
          .schema('batchmaker')
          .from('product_attributes')
          .select('classification_status')
          .eq('picqer_product_id', product.picqer_product_id)
          .single()

        if (updated?.classification_status === 'missing_data') {
          stats.missing_data++
        } else {
          stats.no_match++
        }
      }
    } catch (classifyError) {
      console.error(`[product-classify] Error classifying product ${product.picqer_product_id}:`, classifyError)
      stats.no_match++
    }
  }

  console.log(`[product-classify] Classification complete: ${stats.classified} classified, ${stats.no_match} no_match, ${stats.missing_data} missing_data`)
  return stats
}

// ── Read operations ──────────────────────────────────────────────────────────

/**
 * Get a single product attribute by Picqer product ID
 */
export async function getProductAttribute(picqerProductId: number): Promise<ProductAttribute | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select()
    .eq('picqer_product_id', picqerProductId)
    .maybeSingle()

  if (error) {
    console.error(`Error fetching product attribute for ${picqerProductId}:`, error)
    throw error
  }

  return data
}

/**
 * Get all products that belong to a specific shipping unit
 */
export async function getProductsByShippingUnit(shippingUnitId: string): Promise<ProductAttribute[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select()
    .eq('shipping_unit_id', shippingUnitId)
    .order('product_name', { ascending: true })

  if (error) {
    console.error(`Error fetching products for shipping unit ${shippingUnitId}:`, error)
    throw error
  }

  return data || []
}
