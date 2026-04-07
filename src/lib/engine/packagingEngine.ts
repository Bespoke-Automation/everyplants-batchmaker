/**
 * Packaging Advice Engine
 *
 * Determines the optimal packaging (box) for an order based on:
 * 1. Product attributes and shipping units
 * 2. Compartment rules per packaging
 * 3. Multi-box bin-packing when a single box won't fit
 *
 * Flow: classifyOrderProducts -> matchCompartments -> rankPackagings -> solveMultiBox -> persist
 */

import { supabase } from '@/lib/supabase/client'
import { getOrderTags, addOrderTag, removeOrderTag, getTags, getProductFull, getProductParts } from '@/lib/picqer/client'
import { syncProductFromPicqer, classifyProduct, syncCompositionParts } from '@/lib/supabase/productAttributes'
import { selectCostForWeight } from './costProvider'
import type { CostEntry } from './costProvider'
import { coreAdvice } from './coreAdvice'

// ── Input / Output types ──────────────────────────────────────────────────

export interface OrderProduct {
  picqer_product_id: number
  productcode: string
  quantity: number
}

export interface ShippingUnitEntry {
  id: string       // shipping_units.id (uuid)
  name: string     // shipping_units.name
  quantity: number
}

export interface ClassificationResult {
  shippingUnits: Map<string, ShippingUnitEntry>  // keyed by shipping_unit id
  unclassified: string[]                          // productcodes that couldn't be classified
  excludedPackaging: string[]                     // productcodes skipped because they are packaging/box products
  excludedNonShippable: string[]                  // productcodes skipped because they are accessories/flyers/logistics
}

export interface PackagingMatch {
  packaging_id: string   // packagings.id (uuid)
  packaging_name: string
  idpackaging: number    // Picqer ID
  barcode: string | null // from packagings.barcode
  facturatie_box_sku: string | null // join key for published_box_costs lookup
  rule_group: number
  covered_units: Map<string, number>  // shipping_unit_id -> qty consumed
  leftover_units: Map<string, number> // shipping_unit_id -> qty remaining
  specificity_score: number
  volume: number
  box_cost: number       // from CostEntry.boxCost (0 if not enriched)
  box_pick_cost: number  // from CostEntry.boxPickCost (0 if not enriched)
  box_pack_cost: number  // from CostEntry.boxPackCost (0 if not enriched)
  transport_cost: number // from CostEntry.transportCost (0 if not enriched)
  total_cost: number
  carrier_code: string | null  // from CostEntry.carrier (null if not enriched)
  max_weight: number
}

export interface AdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number           // box material cost (from CostEntry.boxCost)
  box_pick_cost?: number      // pick cost per box type (from CostEntry.boxPickCost)
  box_pack_cost?: number      // pack cost per box type (from CostEntry.boxPackCost)
  transport_cost?: number     // transport cost (from CostEntry.transportCost)
  total_cost?: number         // total = material + pick + pack + transport (from CostEntry.totalCost)
  carrier_code?: string       // selected carrier e.g. "PostNL", "DPD" (from CostEntry.carrier)
  weight_grams?: number       // Total weight of products in this box (grams)
  weight_bracket?: string | null  // Selected weight bracket (e.g., '0-5kg') or null for DPD/pallet
}

export interface AlternativePackaging {
  packaging_id: string
  name: string
  idpackaging: number
  box_cost?: number
  box_pick_cost?: number
  box_pack_cost?: number
  transport_cost?: number
  total_cost?: number
  carrier_code?: string
  is_recommended: boolean
  is_cheapest: boolean
}

export interface PackagingAdviceResult {
  id: string
  order_id: number
  picklist_id: number | null
  status: 'calculated' | 'applied' | 'invalidated' | 'overridden'
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: AdviceBox[]
  alternatives: AlternativePackaging[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  tags_written: string[]
  calculated_at: string
  weight_exceeded: boolean
  shipping_unit_fingerprint: string | null
  cost_data_available: boolean
  reasoning?: string[]
}

// ── DB row types (internal) ───────────────────────────────────────────────

interface ProductAttributeRow {
  id: string
  picqer_product_id: number
  productcode: string
  product_name: string
  product_type: string
  is_composition: boolean
  weight: number | null
  is_fragile: boolean
  is_mixable: boolean
  shipping_unit_id: string | null
  classification_status: string
}

// Cache of packaging barcodes from the packagings table (refreshed per engine call)
let _packagingBarcodesCache: Set<string> | null = null
let _packagingBarcodesCacheTime = 0
const PACKAGING_BARCODES_CACHE_TTL = 60_000 // 1 minute

async function getPackagingBarcodes(): Promise<Set<string>> {
  if (_packagingBarcodesCache && Date.now() - _packagingBarcodesCacheTime < PACKAGING_BARCODES_CACHE_TTL) {
    return _packagingBarcodesCache
  }
  const { data } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('barcode')
    .eq('active', true)
  const barcodes = new Set<string>()
  for (const row of data || []) {
    if (row.barcode) barcodes.add(row.barcode)
  }
  _packagingBarcodesCache = barcodes
  _packagingBarcodesCacheTime = Date.now()
  return barcodes
}

interface CompositionPartRow {
  parent_product_id: number
  part_product_id: number
  amount: number
  part_shipping_unit_id: string | null
}

interface ShippingUnitRow {
  id: string
  name: string
}

interface CompartmentRuleRow {
  id: string
  packaging_id: string
  rule_group: number
  shipping_unit_id: string
  quantity: number
  operator: string
  alternative_for_id: string | null
  sort_order: number
}

interface PackagingRow {
  id: string
  idpackaging: number
  name: string
  barcode: string | null
  facturatie_box_sku: string | null  // join key for cost provider lookup (published_box_costs)
  picqer_tag_name: string | null
  specificity_score: number
  volume: number | null
  handling_cost: number | null
  material_cost: number | null
  max_weight: number | null
}

// ── 1. classifyOrderProducts ──────────────────────────────────────────────

export async function classifyOrderProducts(
  products: OrderProduct[]
): Promise<ClassificationResult> {
  const shippingUnits = new Map<string, ShippingUnitEntry>()
  const unclassified: string[] = []
  const excludedPackaging: string[] = []
  const excludedNonShippable: string[] = []

  if (products.length === 0) {
    return { shippingUnits, unclassified, excludedPackaging, excludedNonShippable }
  }

  // Pre-filter: exclude products whose productcode matches a known packaging barcode
  const packagingBarcodes = await getPackagingBarcodes()
  const realProducts: OrderProduct[] = []
  for (const p of products) {
    if (packagingBarcodes.has(p.productcode)) {
      excludedPackaging.push(p.productcode)
    } else {
      realProducts.push(p)
    }
  }

  if (realProducts.length === 0) {
    return { shippingUnits, unclassified, excludedPackaging, excludedNonShippable }
  }

  // Fetch product attributes for all non-packaging products in the order
  const productIds = realProducts.map(p => p.picqer_product_id)

  const { data: attributes, error: attrError } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('id, picqer_product_id, productcode, product_name, product_type, is_composition, weight, is_fragile, is_mixable, shipping_unit_id, classification_status')
    .in('picqer_product_id', productIds)

  if (attrError) {
    console.error('[packagingEngine] Error fetching product_attributes:', attrError)
    throw new Error(`Failed to fetch product attributes: ${attrError.message}`)
  }

  const attrMap = new Map<number, ProductAttributeRow>()
  for (const row of (attributes || []) as ProductAttributeRow[]) {
    attrMap.set(row.picqer_product_id, row)
  }

  // Pre-filter: exclude non-shippable products (accessories, flyers, logistics items)
  // These don't need packaging advice and shouldn't block the engine.
  const NON_SHIPPABLE_TYPES = new Set(['accessoire'])
  const NON_SHIPPABLE_CODES = new Set(['100000011', '100000012', '100000013']) // Platen, Deense kar, Veiling kar
  const shippableProducts: OrderProduct[] = []
  for (const p of realProducts) {
    const attr = attrMap.get(p.picqer_product_id)
    const productType = attr?.product_type?.toLowerCase() || ''

    // Known non-shippable product types
    if (NON_SHIPPABLE_TYPES.has(productType)) {
      excludedNonShippable.push(p.productcode)
      continue
    }

    // Products with type "Onbekend" and no pot/height data are likely flyers/accessories
    if (productType === 'onbekend' && attr && attr.classification_status === 'missing_data') {
      excludedNonShippable.push(p.productcode)
      continue
    }

    // Short numeric codes without attributes (flyers like "1", "2")
    if (!attr && /^[0-9]{1,3}$/.test(p.productcode)) {
      excludedNonShippable.push(p.productcode)
      continue
    }

    // Known logistics item codes
    if (NON_SHIPPABLE_CODES.has(p.productcode)) {
      excludedNonShippable.push(p.productcode)
      continue
    }

    shippableProducts.push(p)
  }

  if (shippableProducts.length === 0) {
    return { shippingUnits, unclassified, excludedPackaging, excludedNonShippable }
  }

  // ── On-demand classification: fetch missing or unclassified products from Picqer ──────
  const missingProductIds = shippableProducts
    .filter(p => {
      const attr = attrMap.get(p.picqer_product_id)
      // Fetch if not in DB, or if not yet classified (data may have been updated in Picqer)
      return !attr || attr.classification_status !== 'classified'
    })
    .map(p => p.picqer_product_id)

  if (missingProductIds.length > 0) {
    console.log(`[packagingEngine] On-demand: fetching ${missingProductIds.length} products from Picqer`)

    // Process in batches of 5 to respect Picqer rate limits
    for (let i = 0; i < missingProductIds.length; i += 5) {
      const batch = missingProductIds.slice(i, i + 5)
      await Promise.all(batch.map(async (pid) => {
        try {
          // 1. Fetch full product from Picqer
          const fullProduct = await getProductFull(pid)

          // 2. Sync to product_attributes
          await syncProductFromPicqer(fullProduct)

          // 3. Handle compositions
          const isComposition = (fullProduct.type || '').includes('composition')
          if (isComposition) {
            const parts = await getProductParts(pid)
            await syncCompositionParts(pid, parts)
          }

          // 4. Classify against shipping_units
          await classifyProduct(pid)

          // 5. Re-fetch from DB and add to attrMap
          const { data: attr } = await supabase
            .schema('batchmaker')
            .from('product_attributes')
            .select('id, picqer_product_id, productcode, product_name, product_type, is_composition, weight, is_fragile, is_mixable, shipping_unit_id, classification_status')
            .eq('picqer_product_id', pid)
            .single()

          if (attr) attrMap.set(pid, attr as ProductAttributeRow)
        } catch (err) {
          console.error(`[packagingEngine] On-demand: failed for product ${pid}:`, err)
          // Product stays missing → will be unclassified
        }
      }))
    }

    console.log(`[packagingEngine] On-demand: completed, attrMap now has ${attrMap.size} products`)
  }

  // Helper: add quantity to the shipping units map
  function addUnits(unitId: string, unitName: string, qty: number) {
    const existing = shippingUnits.get(unitId)
    if (existing) {
      existing.quantity += qty
    } else {
      shippingUnits.set(unitId, { id: unitId, name: unitName, quantity: qty })
    }
  }

  // Pre-fetch all shipping unit names we might need
  const allShippingUnitIds = new Set<string>()
  for (const attr of attrMap.values()) {
    if (attr.shipping_unit_id) allShippingUnitIds.add(attr.shipping_unit_id)
  }

  // Identify composition products that need part expansion
  const compositionProductIds = shippableProducts
    .filter(p => {
      const attr = attrMap.get(p.picqer_product_id)
      return attr && attr.is_composition && attr.classification_status !== 'classified'
    })
    .map(p => p.picqer_product_id)

  // Fetch composition parts if needed
  let partsMap = new Map<number, CompositionPartRow[]>()
  if (compositionProductIds.length > 0) {
    const { data: parts, error: partsError } = await supabase
      .schema('batchmaker')
      .from('product_composition_parts')
      .select('parent_product_id, part_product_id, amount, part_shipping_unit_id')
      .in('parent_product_id', compositionProductIds)

    if (partsError) {
      console.error('[packagingEngine] Error fetching composition parts:', partsError)
      throw new Error(`Failed to fetch composition parts: ${partsError.message}`)
    }

    for (const part of (parts || []) as CompositionPartRow[]) {
      if (!partsMap.has(part.parent_product_id)) {
        partsMap.set(part.parent_product_id, [])
      }
      partsMap.get(part.parent_product_id)!.push(part)
      if (part.part_shipping_unit_id) {
        allShippingUnitIds.add(part.part_shipping_unit_id)
      }
    }

    // For parts without part_shipping_unit_id, look up from product_attributes
    const partProductIds = (parts || [])
      .filter((p: CompositionPartRow) => !p.part_shipping_unit_id)
      .map((p: CompositionPartRow) => p.part_product_id)

    if (partProductIds.length > 0) {
      const { data: partAttrs } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('picqer_product_id, shipping_unit_id')
        .in('picqer_product_id', partProductIds)

      const partAttrMap = new Map<number, string | null>()
      for (const pa of (partAttrs || [])) {
        partAttrMap.set(pa.picqer_product_id, pa.shipping_unit_id)
        if (pa.shipping_unit_id) allShippingUnitIds.add(pa.shipping_unit_id)
      }

      // Enrich parts with shipping unit from product_attributes
      for (const [parentId, partsList] of partsMap) {
        for (const part of partsList) {
          if (!part.part_shipping_unit_id) {
            part.part_shipping_unit_id = partAttrMap.get(part.part_product_id) ?? null
          }
        }
      }
    }
  }

  // Fetch shipping unit names
  const unitNameMap = new Map<string, string>()
  if (allShippingUnitIds.size > 0) {
    const { data: units } = await supabase
      .schema('batchmaker')
      .from('shipping_units')
      .select('id, name')
      .in('id', Array.from(allShippingUnitIds))

    for (const u of (units || []) as ShippingUnitRow[]) {
      unitNameMap.set(u.id, u.name)
    }
  }

  // Process each product (packaging + non-shippable products already filtered out above)
  for (const product of shippableProducts) {
    const attr = attrMap.get(product.picqer_product_id)

    if (!attr) {
      // Product not in product_attributes at all
      unclassified.push(product.productcode)
      continue
    }

    if (attr.classification_status === 'unclassified' || attr.classification_status === 'no_match' || attr.classification_status === 'missing_data') {
      unclassified.push(product.productcode)
      continue
    }

    // Check if it's a composition that needs expansion
    if (attr.is_composition && attr.classification_status !== 'classified') {
      const parts = partsMap.get(product.picqer_product_id) || []
      if (parts.length === 0) {
        // Composition with no parts found
        unclassified.push(product.productcode)
        continue
      }

      let allPartsResolved = true
      for (const part of parts) {
        if (part.part_shipping_unit_id) {
          const unitName = unitNameMap.get(part.part_shipping_unit_id) || 'Unknown'
          addUnits(part.part_shipping_unit_id, unitName, part.amount * product.quantity)
        } else {
          allPartsResolved = false
        }
      }

      if (!allPartsResolved) {
        unclassified.push(product.productcode)
      }
      continue
    }

    // Directly classified product
    if (attr.shipping_unit_id) {
      const unitName = unitNameMap.get(attr.shipping_unit_id) || 'Unknown'
      addUnits(attr.shipping_unit_id, unitName, product.quantity)
    } else {
      unclassified.push(product.productcode)
    }
  }

  console.log(`[packagingEngine] Classification result: ${shippingUnits.size} shipping unit types, ${unclassified.length} unclassified, ${excludedPackaging.length} excluded packaging, ${excludedNonShippable.length} excluded non-shippable`)
  return { shippingUnits, unclassified, excludedPackaging, excludedNonShippable }
}

// ── 2. matchCompartments ──────────────────────────────────────────────────

export async function matchCompartments(
  shippingUnits: Map<string, ShippingUnitEntry>
): Promise<PackagingMatch[]> {
  if (shippingUnits.size === 0) return []

  // Fetch all active packagings that are used in auto advice
  const { data: packagings, error: pkgError } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, idpackaging, name, barcode, facturatie_box_sku, picqer_tag_name, specificity_score, volume, handling_cost, material_cost, max_weight')
    .eq('active', true)
    .eq('use_in_auto_advice', true)

  if (pkgError) {
    console.error('[packagingEngine] Error fetching packagings:', pkgError)
    throw new Error(`Failed to fetch packagings: ${pkgError.message}`)
  }

  if (!packagings || packagings.length === 0) {
    console.log('[packagingEngine] No active packagings with use_in_auto_advice=true')
    return []
  }

  const packagingIds = packagings.map((p: PackagingRow) => p.id)

  // Fetch all active compartment rules for these packagings
  const { data: rules, error: rulesError } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .select('id, packaging_id, rule_group, shipping_unit_id, quantity, operator, alternative_for_id, sort_order')
    .in('packaging_id', packagingIds)
    .eq('is_active', true)
    .order('rule_group')
    .order('sort_order')

  if (rulesError) {
    console.error('[packagingEngine] Error fetching compartment_rules:', rulesError)
    throw new Error(`Failed to fetch compartment rules: ${rulesError.message}`)
  }

  // Group rules by packaging_id, then by rule_group
  const rulesByPackaging = new Map<string, Map<number, CompartmentRuleRow[]>>()
  for (const rule of (rules || []) as CompartmentRuleRow[]) {
    if (!rulesByPackaging.has(rule.packaging_id)) {
      rulesByPackaging.set(rule.packaging_id, new Map())
    }
    const groups = rulesByPackaging.get(rule.packaging_id)!
    if (!groups.has(rule.rule_group)) {
      groups.set(rule.rule_group, [])
    }
    groups.get(rule.rule_group)!.push(rule)
  }

  const matches: PackagingMatch[] = []

  for (const pkg of packagings as PackagingRow[]) {
    const groups = rulesByPackaging.get(pkg.id)
    if (!groups) continue

    for (const [groupNum, groupRules] of groups) {
      const matchResult = evaluateRuleGroup(groupRules, shippingUnits)
      if (matchResult) {
        matches.push({
          packaging_id: pkg.id,
          packaging_name: pkg.picqer_tag_name || pkg.name,
          idpackaging: pkg.idpackaging,
          barcode: pkg.barcode ?? null,
          facturatie_box_sku: pkg.facturatie_box_sku ?? null,
          rule_group: groupNum,
          covered_units: matchResult.covered,
          leftover_units: matchResult.leftover,
          specificity_score: pkg.specificity_score ?? 50,
          volume: pkg.volume ?? Infinity,
          box_cost: 0,
          box_pick_cost: 0,
          box_pack_cost: 0,
          transport_cost: 0,
          total_cost: (pkg.handling_cost ?? 0) + (pkg.material_cost ?? 0),
          carrier_code: null,
          max_weight: pkg.max_weight ?? Infinity,
        })
      }
    }
  }

  console.log(`[packagingEngine] Found ${matches.length} packaging matches`)
  return matches
}

/**
 * Evaluate a single rule group against the order's shipping units.
 * Returns covered and leftover units if the group matches, or null if it doesn't.
 */
function evaluateRuleGroup(
  rules: CompartmentRuleRow[],
  orderUnits: Map<string, ShippingUnitEntry>
): { covered: Map<string, number>; leftover: Map<string, number> } | null {
  // Build a mutable copy of order quantities
  const remaining = new Map<string, number>()
  for (const [id, entry] of orderUnits) {
    remaining.set(id, entry.quantity)
  }

  const covered = new Map<string, number>()

  // Separate rules by type (NULL operator treated as EN for robustness)
  const enRules = rules.filter(r => r.operator === 'EN' || r.operator == null)
  const ofRules = rules.filter(r => r.operator === 'OF')
  const altRules = rules.filter(r => r.operator === 'ALTERNATIEF')

  // Build alternative lookup: alternative_for_id -> alternative rule
  const altLookup = new Map<string, CompartmentRuleRow[]>()
  for (const alt of altRules) {
    if (alt.alternative_for_id) {
      if (!altLookup.has(alt.alternative_for_id)) {
        altLookup.set(alt.alternative_for_id, [])
      }
      altLookup.get(alt.alternative_for_id)!.push(alt)
    }
  }

  // Process EN rules: ALL must be satisfiable
  // rule.quantity = max CAPACITY of the box for this unit type, not a minimum requirement.
  // A box that fits 4 plants should also match an order of 2 plants (consume min(available, capacity)).
  for (const rule of enRules) {
    const available = remaining.get(rule.shipping_unit_id) ?? 0
    if (available > 0) {
      // Primary rule matches — consume up to capacity
      const consume = Math.min(available, rule.quantity)
      remaining.set(rule.shipping_unit_id, available - consume)
      covered.set(rule.shipping_unit_id, (covered.get(rule.shipping_unit_id) ?? 0) + consume)
    } else {
      // Check alternatives for this rule
      const alternatives = altLookup.get(rule.id) || []
      let altMatched = false
      for (const alt of alternatives) {
        const altAvailable = remaining.get(alt.shipping_unit_id) ?? 0
        if (altAvailable > 0) {
          const consume = Math.min(altAvailable, alt.quantity)
          remaining.set(alt.shipping_unit_id, altAvailable - consume)
          covered.set(alt.shipping_unit_id, (covered.get(alt.shipping_unit_id) ?? 0) + consume)
          altMatched = true
          break
        }
      }
      if (!altMatched) {
        return null // EN rule not satisfiable — this unit type is not in the order
      }
    }
  }

  // Process OF rules: at least ONE must match
  if (ofRules.length > 0) {
    let anyOfMatched = false
    for (const rule of ofRules) {
      const available = remaining.get(rule.shipping_unit_id) ?? 0
      if (available > 0) {
        const consume = Math.min(available, rule.quantity)
        remaining.set(rule.shipping_unit_id, available - consume)
        covered.set(rule.shipping_unit_id, (covered.get(rule.shipping_unit_id) ?? 0) + consume)
        anyOfMatched = true
        break // Only need one OF to match
      }
    }
    if (!anyOfMatched) {
      return null
    }
  }

  // Build leftover
  const leftover = new Map<string, number>()
  for (const [id, qty] of remaining) {
    if (qty > 0) {
      leftover.set(id, qty)
    }
  }

  return { covered, leftover }
}

// ── 2b. enrichWithCosts ─────────────────────────────────────────────────

/**
 * Enrich packaging matches with cost data from the cost provider.
 * - Matches whose facturatie_box_sku has cost entries: overwrite box_cost, transport_cost, total_cost
 * - Matches whose facturatie_box_sku has NO cost entry: EXCLUDED (no preferred route for this country)
 * - Matches without facturatie_box_sku: kept with original total_cost (can't look up, but not excluded)
 * - If costMap is null (no cost data): return matches unchanged (graceful degradation)
 *
 * For weight bracket selection: uses NULL bracket entry if available, otherwise first entry.
 * Full weight-based selection happens in refineBoxCostWithWeight (Pass 2).
 *
 * Cost formula: total_cost from published_box_costs includes: box_material + pick + pack + transport.
 * box_cost is set to entry.boxCost (= boxMaterialCost) for downstream UI display.
 * transport_cost is set to entry.transportCost for downstream UI display.
 * total_cost is set from entry.totalCost directly (NOT box_cost + transport_cost, which would miss pick/pack).
 */
export function enrichWithCosts(
  matches: PackagingMatch[],
  costMap: Map<string, CostEntry[]> | null
): PackagingMatch[] {
  if (!costMap) return matches  // No cost data → keep original costs

  return matches
    .map(match => {
      if (!match.facturatie_box_sku) return match  // No SKU mapping → can't look up, keep as-is

      const entries = costMap.get(match.facturatie_box_sku)
      if (!entries || entries.length === 0) return null  // No cost data → EXCLUDE

      // Use the entry with NULL weight_bracket if available (DPD/pallet), otherwise first
      const entry = entries.find(e => e.weightBracket === null) ?? entries[0]

      return {
        ...match,
        box_cost: entry.boxCost,           // = boxMaterialCost (for UI display)
        box_pick_cost: entry.boxPickCost,   // pick cost per box type
        box_pack_cost: entry.boxPackCost,   // pack cost per box type
        transport_cost: entry.transportCost, // = transport_purchase_cost (for UI display)
        // total_cost from published_box_costs includes: box_material + pick + pack + transport
        total_cost: entry.totalCost,
        carrier_code: entry.carrier,        // selected carrier (e.g. "PostNL", "DPD")
      }
    })
    .filter((m): m is PackagingMatch => m !== null)
}

// ── 2c. Weight-aware cost refinement ────────────────────────────────────

/**
 * Calculate total weight of products assigned to a box (in grams).
 * Uses product_attributes.weight data available in the weightMap.
 */
export function calculateBoxWeight(
  boxProducts: { productcode: string; quantity: number }[],
  weightMap: Map<string, number>  // productcode -> weight in grams
): number {
  let total = 0
  for (const bp of boxProducts) {
    const weight = weightMap.get(bp.productcode) ?? 0
    if (weight === 0 && bp.productcode !== '(composition parts)') {
      console.warn(`[packagingEngine] Product ${bp.productcode} has no weight data — treating as 0g`)
    }
    total += weight * bp.quantity
  }
  return total
}

/**
 * Refine a box's cost using its actual weight to select the correct bracket.
 *
 * Pass 1 (enrichWithCosts) uses NULL bracket or first entry as estimate for ranking.
 * Pass 2 (this function) recalculates with the real weight after products are assigned.
 *
 * For PostNL: selects the smallest bracket that fits (0-5kg, 5-10kg, 10-20kg, 20-30kg).
 * For DPD/pallet (NULL bracket): weight is irrelevant, entry always matches.
 * If weight exceeds all brackets and no NULL entry exists: no cost (returns box unchanged).
 */
export function refineBoxCostWithWeight(
  box: AdviceBox,
  costEntries: CostEntry[] | undefined,
  weightMap: Map<string, number>
): AdviceBox {
  const weight = calculateBoxWeight(box.products, weightMap)

  if (!costEntries || costEntries.length === 0) {
    // No cost data for this box — just add weight info
    return { ...box, weight_grams: weight }
  }

  const entry = selectCostForWeight(costEntries, weight)
  if (!entry) {
    // No bracket matches this weight — keep existing costs, add weight info
    console.warn(`[packagingEngine] No cost bracket for ${box.packaging_name} at ${weight}g — keeping initial estimate`)
    return { ...box, weight_grams: weight }
  }

  return {
    ...box,
    box_cost: entry.boxCost,
    box_pick_cost: entry.boxPickCost,
    box_pack_cost: entry.boxPackCost,
    transport_cost: entry.transportCost,
    total_cost: entry.totalCost,
    carrier_code: entry.carrier,
    weight_grams: weight,
    weight_bracket: entry.weightBracket,
  }
}

// ── 3. rankPackagings ─────────────────────────────────────────────────────

export function rankPackagings(
  matches: PackagingMatch[],
  costDataAvailable: boolean = false
): PackagingMatch[] {
  return [...matches].sort((a, b) => {
    if (costDataAvailable) {
      // PRIMARY: total_cost ASC (cheapest first)
      if (a.total_cost !== b.total_cost) {
        return a.total_cost - b.total_cost
      }
      // TIEBREAKER 1: specificity_score DESC (most specific first)
      if (b.specificity_score !== a.specificity_score) {
        return b.specificity_score - a.specificity_score
      }
      // TIEBREAKER 2: volume ASC (smallest box first)
      return a.volume - b.volume
    }
    // Fallback: original ranking (no cost data)
    if (b.specificity_score !== a.specificity_score) {
      return b.specificity_score - a.specificity_score
    }
    if (a.volume !== b.volume) {
      return a.volume - b.volume
    }
    return a.total_cost - b.total_cost
  })
}

// ── 4a. Cost-optimal multi-box solver (branch-and-bound) ─────────────────

interface MultiBoxCandidate {
  match: PackagingMatch
  coveredUnits: Map<string, number>  // what this box covers from the remaining pool
  cost: number                        // total_cost of this box
}

interface MultiBoxSolution {
  boxes: MultiBoxCandidate[]
  totalCost: number
}

/**
 * Non-greedy multi-box solver using bounded branch-and-bound search.
 *
 * Evaluates multiple packaging combinations to find the lowest total cost.
 * Has a timeout (default 200ms) and depth limit (max 5 boxes) to prevent
 * excessive computation on large orders.
 *
 * @returns The cheapest solution found within the time limit, or null if
 *          no complete solution was found (timeout with no valid result).
 */
function solveMultiBoxOptimal(
  pool: Map<string, ShippingUnitEntry>,
  candidates: PackagingMatch[],
  costDataAvailable: boolean,
  timeoutMs: number = 200
): MultiBoxSolution | null {
  if (!costDataAvailable || candidates.length === 0) return null

  const startTime = Date.now()
  const state = { best: null as MultiBoxSolution | null }

  // Pre-compute which candidates can cover which units from the full pool
  // Sort by total_cost ASC for better pruning (cheapest first)
  const sortedCandidates = [...candidates].sort((a, b) => a.total_cost - b.total_cost)

  // Deduplicate candidates by packaging_id + rule_group to avoid exploring the same box twice
  const seen = new Set<string>()
  const uniqueCandidates = sortedCandidates.filter(c => {
    const key = `${c.packaging_id}:${c.rule_group}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  function evaluateCandidate(
    candidate: PackagingMatch,
    remaining: Map<string, ShippingUnitEntry>
  ): { covered: Map<string, number>; newRemaining: Map<string, ShippingUnitEntry> } | null {
    const covered = new Map<string, number>()
    let coversAnything = false

    for (const [unitId, qty] of candidate.covered_units) {
      const available = remaining.get(unitId)
      if (available && available.quantity > 0) {
        const consume = Math.min(qty, available.quantity)
        covered.set(unitId, consume)
        coversAnything = true
      }
    }

    if (!coversAnything) return null

    // Build reduced pool
    const newRemaining = new Map<string, ShippingUnitEntry>()
    for (const [id, entry] of remaining) {
      const consumed = covered.get(id) ?? 0
      const left = entry.quantity - consumed
      if (left > 0) {
        newRemaining.set(id, { ...entry, quantity: left })
      }
    }

    return { covered, newRemaining }
  }

  function search(
    remaining: Map<string, ShippingUnitEntry>,
    currentBoxes: MultiBoxCandidate[],
    currentCost: number,
    depth: number
  ): void {
    // Timeout check
    if (Date.now() - startTime > timeoutMs) return

    // All units placed? We found a complete solution.
    if (remaining.size === 0) {
      if (!state.best || currentCost < state.best.totalCost) {
        state.best = { boxes: [...currentBoxes], totalCost: currentCost }
      }
      return
    }

    // Depth limit: max 5 boxes (typical orders need 2-4)
    if (depth >= 5) return

    // Pruning: if current cost already >= best, skip this branch
    if (state.best && currentCost >= state.best.totalCost) return

    // Try each candidate against remaining pool
    for (const candidate of uniqueCandidates) {
      // Timeout check inside loop
      if (Date.now() - startTime > timeoutMs) return

      const result = evaluateCandidate(candidate, remaining)
      if (!result) continue

      const boxCandidate: MultiBoxCandidate = {
        match: candidate,
        coveredUnits: result.covered,
        cost: candidate.total_cost,
      }

      search(
        result.newRemaining,
        [...currentBoxes, boxCandidate],
        currentCost + candidate.total_cost,
        depth + 1
      )
    }
  }

  search(pool, [], 0, 0)

  if (state.best) {
    const elapsed = Date.now() - startTime
    console.log(`[packagingEngine] Optimal multi-box: ${state.best.boxes.length} boxes, total EUR ${(state.best.totalCost / 100).toFixed(2)} (found in ${elapsed}ms)`)
  }

  return state.best
}

// ── 4b. Greedy multi-box solver (fallback) ──────────────────────────────

/**
 * Greedy multi-box solver: iteratively picks the packaging that covers the
 * most units until all units are placed. This is the original algorithm
 * extracted for use as a fallback when the optimal solver times out or
 * when cost data is not available.
 */
async function solveMultiBoxGreedy(
  pool: Map<string, ShippingUnitEntry>,
  products: OrderProduct[],
  mixableMap: Map<number, { is_mixable: boolean; shipping_unit_id: string | null; weight: number; productcode: string }>,
  weightMap: Map<string, number>,
  costMap: Map<string, CostEntry[]> | null,
  costDataAvailable: boolean,
  getCostEntries: (match: PackagingMatch) => CostEntry[] | undefined
): Promise<AdviceBox[] | null> {
  const boxes: AdviceBox[] = []
  let iterations = 0
  const maxIterations = 20 // Safety limit

  while (pool.size > 0 && iterations < maxIterations) {
    iterations++

    // Re-match for remaining pool
    const poolMatches = await matchCompartments(pool)
    const enrichedPool = enrichWithCosts(poolMatches, costMap)
    const poolRanked = rankPackagings(enrichedPool, costDataAvailable)

    if (poolRanked.length === 0) {
      // Can't place remaining units
      return null
    }

    // Pick the packaging that covers the most units (by count) among top-specificity matches
    const bestMatch = pickBestCoverage(poolRanked)

    const boxProducts = buildProductList(bestMatch.covered_units, pool, products, mixableMap)
    let greedyBox: AdviceBox = {
      packaging_id: bestMatch.packaging_id,
      packaging_name: bestMatch.packaging_name,
      idpackaging: bestMatch.idpackaging,
      products: boxProducts,
      box_cost: bestMatch.box_cost || undefined,
      box_pick_cost: bestMatch.box_pick_cost || undefined,
      box_pack_cost: bestMatch.box_pack_cost || undefined,
      transport_cost: bestMatch.transport_cost || undefined,
      total_cost: bestMatch.total_cost || undefined,
      carrier_code: bestMatch.carrier_code ?? undefined,
    }
    // Refine cost with actual weight for this box's products
    greedyBox = refineBoxCostWithWeight(greedyBox, getCostEntries(bestMatch), weightMap)
    boxes.push(greedyBox)

    // Remove covered units from pool
    for (const [unitId, qty] of bestMatch.covered_units) {
      const current = pool.get(unitId)
      if (current) {
        current.quantity -= qty
        if (current.quantity <= 0) {
          pool.delete(unitId)
        }
      }
    }
  }

  if (pool.size > 0) {
    // Couldn't place everything
    return null
  }

  return boxes
}

// ── 4c. solveMultiBox (main entry point) ─────────────────────────────────

export async function solveMultiBox(
  shippingUnits: Map<string, ShippingUnitEntry>,
  unclassified: string[],
  allMatches: PackagingMatch[],
  products: OrderProduct[],
  costMap: Map<string, CostEntry[]> | null = null,
  costDataAvailable: boolean = false
): Promise<{ boxes: AdviceBox[]; confidence: 'full_match' | 'partial_match' | 'no_match' }> {
  // If nothing to pack, no advice needed
  if (shippingUnits.size === 0 && unclassified.length === 0) {
    return { boxes: [], confidence: 'no_match' }
  }

  // If there are unclassified products, we can only give partial or no match
  const hasUnclassified = unclassified.length > 0

  // Fetch is_mixable flags for products that have shipping units
  const productIds = products.map(p => p.picqer_product_id)
  const { data: mixableData } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, productcode, is_mixable, shipping_unit_id, weight')
    .in('picqer_product_id', productIds)

  const mixableMap = new Map<number, { is_mixable: boolean; shipping_unit_id: string | null; weight: number; productcode: string }>()
  for (const row of (mixableData || [])) {
    mixableMap.set(row.picqer_product_id, {
      is_mixable: row.is_mixable ?? true,
      shipping_unit_id: row.shipping_unit_id,
      weight: row.weight ?? 0,
      productcode: row.productcode,
    })
  }

  // Build weight map: productcode -> weight in grams (for weight-aware cost refinement)
  const weightMap = new Map<string, number>()
  for (const attrs of mixableMap.values()) {
    weightMap.set(attrs.productcode, attrs.weight)
  }

  // Helper to get cost entries for a packaging match
  const getCostEntries = (match: PackagingMatch): CostEntry[] | undefined => {
    if (!costMap || !match.facturatie_box_sku) return undefined
    return costMap.get(match.facturatie_box_sku)
  }

  // Identify non-mixable products: they MUST go in their own box
  const nonMixableProducts: { product: OrderProduct; shipping_unit_id: string; shipping_unit_name: string }[] = []
  const mixableRemaining = new Map<string, ShippingUnitEntry>()

  // Copy shipping units
  for (const [id, entry] of shippingUnits) {
    mixableRemaining.set(id, { ...entry })
  }

  for (const product of products) {
    const attrs = mixableMap.get(product.picqer_product_id)
    if (attrs && !attrs.is_mixable && attrs.shipping_unit_id) {
      const unitName = shippingUnits.get(attrs.shipping_unit_id)?.name || 'Unknown'
      // Each unit of a non-mixable product goes into its own box
      for (let i = 0; i < product.quantity; i++) {
        nonMixableProducts.push({
          product,
          shipping_unit_id: attrs.shipping_unit_id,
          shipping_unit_name: unitName,
        })
      }
      // Remove from mixable pool
      const current = mixableRemaining.get(attrs.shipping_unit_id)
      if (current) {
        current.quantity -= product.quantity
        if (current.quantity <= 0) {
          mixableRemaining.delete(attrs.shipping_unit_id)
        }
      }
    }
  }

  const boxes: AdviceBox[] = []

  // Handle non-mixable products: each gets its own box
  for (const nm of nonMixableProducts) {
    // Find a matching packaging for just this single unit
    const singleUnit = new Map<string, ShippingUnitEntry>()
    singleUnit.set(nm.shipping_unit_id, { id: nm.shipping_unit_id, name: nm.shipping_unit_name, quantity: 1 })

    const singleMatches = await matchCompartments(singleUnit)
    const enrichedSingle = enrichWithCosts(singleMatches, costMap)
    const ranked = rankPackagings(enrichedSingle, costDataAvailable)

    // Find a perfect match (no leftovers)
    const perfectMatch = ranked.find(m => m.leftover_units.size === 0)

    if (perfectMatch) {
      let nmBox: AdviceBox = {
        packaging_id: perfectMatch.packaging_id,
        packaging_name: perfectMatch.packaging_name,
        idpackaging: perfectMatch.idpackaging,
        products: [{
          productcode: nm.product.productcode,
          shipping_unit_name: nm.shipping_unit_name,
          quantity: 1,
        }],
        box_cost: perfectMatch.box_cost || undefined,
        box_pick_cost: perfectMatch.box_pick_cost || undefined,
        box_pack_cost: perfectMatch.box_pack_cost || undefined,
        transport_cost: perfectMatch.transport_cost || undefined,
        total_cost: perfectMatch.total_cost || undefined,
        carrier_code: perfectMatch.carrier_code ?? undefined,
      }
      // Refine cost with actual weight for this single-product box
      nmBox = refineBoxCostWithWeight(nmBox, getCostEntries(perfectMatch), weightMap)
      boxes.push(nmBox)
    } else {
      // No packaging found for this non-mixable product
      // Return no_match — we don't force a box
      return {
        boxes: [],
        confidence: 'no_match',
      }
    }
  }

  // Now handle mixable products
  if (mixableRemaining.size > 0) {
    // Re-match with only the mixable remaining units
    const mixableMatches = allMatches.length > 0
      ? recalculateMatchesForRemaining(allMatches, mixableRemaining)
      : enrichWithCosts(await matchCompartments(mixableRemaining), costMap)

    const ranked = rankPackagings(mixableMatches, costDataAvailable)

    // Try single-box solution first: does any packaging match ALL remaining units?
    const singleBoxMatch = ranked.find(m => m.leftover_units.size === 0)

    if (singleBoxMatch) {
      // Build product list for this box
      const boxProducts = buildProductList(singleBoxMatch.covered_units, shippingUnits, products, mixableMap)
      let singleBox: AdviceBox = {
        packaging_id: singleBoxMatch.packaging_id,
        packaging_name: singleBoxMatch.packaging_name,
        idpackaging: singleBoxMatch.idpackaging,
        products: boxProducts,
        box_cost: singleBoxMatch.box_cost || undefined,
        box_pick_cost: singleBoxMatch.box_pick_cost || undefined,
        box_pack_cost: singleBoxMatch.box_pack_cost || undefined,
        transport_cost: singleBoxMatch.transport_cost || undefined,
        total_cost: singleBoxMatch.total_cost || undefined,
        carrier_code: singleBoxMatch.carrier_code ?? undefined,
      }
      // Refine cost with actual weight
      singleBox = refineBoxCostWithWeight(singleBox, getCostEntries(singleBoxMatch), weightMap)
      boxes.push(singleBox)
    } else {
      // Multi-box split: try cost-optimal solver first, fall back to greedy
      const pool = new Map<string, ShippingUnitEntry>()
      for (const [id, entry] of mixableRemaining) {
        pool.set(id, { ...entry })
      }

      let multiBoxSolved = false

      // 1. Try cost-optimal solver (with 200ms timeout) when cost data is available
      if (costDataAvailable) {
        // Generate fresh candidates for the full remaining pool
        const poolMatches = await matchCompartments(pool)
        const enrichedPool = enrichWithCosts(poolMatches, costMap)

        const optimalSolution = solveMultiBoxOptimal(
          pool,
          enrichedPool,
          costDataAvailable,
          200  // 200ms timeout
        )

        if (optimalSolution && optimalSolution.boxes.length > 0) {
          // Convert MultiBoxCandidate[] to AdviceBox[] with weight refinement
          for (const candidate of optimalSolution.boxes) {
            const boxProducts = buildProductList(candidate.coveredUnits, pool, products, mixableMap)
            let optBox: AdviceBox = {
              packaging_id: candidate.match.packaging_id,
              packaging_name: candidate.match.packaging_name,
              idpackaging: candidate.match.idpackaging,
              products: boxProducts,
              box_cost: candidate.match.box_cost || undefined,
              box_pick_cost: candidate.match.box_pick_cost || undefined,
              box_pack_cost: candidate.match.box_pack_cost || undefined,
              transport_cost: candidate.match.transport_cost || undefined,
              total_cost: candidate.cost || undefined,
              carrier_code: candidate.match.carrier_code ?? undefined,
            }
            optBox = refineBoxCostWithWeight(optBox, getCostEntries(candidate.match), weightMap)
            boxes.push(optBox)
          }
          // All units placed by optimal solver
          pool.clear()
          multiBoxSolved = true
        }
      }

      // 2. Fallback: greedy solver (when optimal didn't find solution or no cost data)
      if (!multiBoxSolved && pool.size > 0) {
        console.log('[packagingEngine] Multi-box: falling back to greedy solver')
        const greedyBoxes = await solveMultiBoxGreedy(
          pool, products, mixableMap, weightMap,
          costMap, costDataAvailable, getCostEntries
        )

        if (greedyBoxes === null) {
          return { boxes: [], confidence: 'no_match' }
        }

        boxes.push(...greedyBoxes)
      }
    }
  }

  // Determine confidence
  let confidence: 'full_match' | 'partial_match' | 'no_match' = 'full_match'
  if (hasUnclassified) {
    confidence = boxes.length > 0 ? 'partial_match' : 'no_match'
  }
  if (boxes.length === 0 && !hasUnclassified) {
    confidence = 'no_match'
  }

  return { boxes, confidence }
}

// ── 4d. Strapped consolidation ────────────────────────────────────────────

/**
 * After multi-box solving, check if 2+ boxes use the same packaging that has
 * a strapped variant (e.g. 2x Kokerdoos → 1 strapped doublepack).
 * If so, consolidate pairs into the strapped variant.
 *
 * Uses the `strapped_variant_id` column on the `packagings` table.
 */
export async function applyStrappedConsolidation(
  boxes: AdviceBox[],
  costMap: Map<string, CostEntry[]> | null
): Promise<AdviceBox[]> {
  if (boxes.length < 2) return boxes

  // Count boxes per packaging_id
  const countByPkg = new Map<string, number>()
  for (const box of boxes) {
    countByPkg.set(box.packaging_id, (countByPkg.get(box.packaging_id) ?? 0) + 1)
  }

  // Find packagings that appear 2+ times
  const duplicatePkgIds = Array.from(countByPkg.entries())
    .filter(([, count]) => count >= 2)
    .map(([id]) => id)

  if (duplicatePkgIds.length === 0) return boxes

  // Fetch strapped variants for these packagings
  const { data: strappedData } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, strapped_variant_id')
    .in('id', duplicatePkgIds)
    .not('strapped_variant_id', 'is', null)

  if (!strappedData || strappedData.length === 0) return boxes

  // Fetch strapped variant details
  const variantIds = strappedData.map(s => s.strapped_variant_id!)
  const { data: variants } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, idpackaging, name, facturatie_box_sku, num_shipping_labels, active')
    .in('id', variantIds)
    .eq('active', true)

  if (!variants || variants.length === 0) return boxes

  const variantMap = new Map(variants.map(v => [v.id, v]))
  const strappedLookup = new Map<string, string>() // base packaging_id → strapped variant id
  for (const s of strappedData) {
    if (variantMap.has(s.strapped_variant_id!)) {
      strappedLookup.set(s.id, s.strapped_variant_id!)
    }
  }

  if (strappedLookup.size === 0) return boxes

  // Consolidate: pair up boxes and replace with strapped variant
  const result: AdviceBox[] = []
  const consumed = new Set<number>() // indices of boxes consumed by strapped pairs

  for (const [basePkgId, strappedVariantId] of strappedLookup) {
    const variant = variantMap.get(strappedVariantId)!
    const indices = boxes
      .map((b, i) => ({ box: b, index: i }))
      .filter(({ box, index }) => box.packaging_id === basePkgId && !consumed.has(index))

    // Pair them up (2 at a time)
    for (let i = 0; i + 1 < indices.length; i += 2) {
      const box1 = indices[i].box
      const box2 = indices[i + 1].box
      consumed.add(indices[i].index)
      consumed.add(indices[i + 1].index)

      // Merge products
      const mergedProducts = [...box1.products]
      for (const p of box2.products) {
        const existing = mergedProducts.find(
          ep => ep.productcode === p.productcode && ep.shipping_unit_name === p.shipping_unit_name
        )
        if (existing) {
          existing.quantity += p.quantity
        } else {
          mergedProducts.push({ ...p })
        }
      }

      // Build strapped box with cost data
      let strappedBox: AdviceBox = {
        packaging_id: variant.id,
        packaging_name: variant.name,
        idpackaging: variant.idpackaging,
        products: mergedProducts,
      }

      // Enrich with cost data if available
      if (costMap && variant.facturatie_box_sku) {
        const entries = costMap.get(variant.facturatie_box_sku)
        if (entries && entries.length > 0) {
          const entry = entries[0] // Use first entry (weight refinement happens later)
          strappedBox.box_cost = entry.boxCost
          strappedBox.box_pick_cost = entry.boxPickCost
          strappedBox.box_pack_cost = entry.boxPackCost
          strappedBox.transport_cost = entry.transportCost
          strappedBox.total_cost = entry.totalCost
          strappedBox.carrier_code = entry.carrier
        }
      }

      console.log(`[packagingEngine] Strapped consolidation: 2x "${box1.packaging_name}" → 1x "${variant.name}"`)
      result.push(strappedBox)
    }
  }

  // Add remaining non-consumed boxes
  for (let i = 0; i < boxes.length; i++) {
    if (!consumed.has(i)) {
      result.push(boxes[i])
    }
  }

  return result
}

/**
 * Recalculate matches for a subset of the original shipping units.
 * Filters allMatches to only those that can still be satisfied by remaining units.
 */
function recalculateMatchesForRemaining(
  allMatches: PackagingMatch[],
  remaining: Map<string, ShippingUnitEntry>
): PackagingMatch[] {
  // We need to re-evaluate each match against the remaining units
  // This is a simplification — for accuracy, we should re-run matchCompartments
  // But for performance, we filter: a match is valid if all covered units are available in remaining
  return allMatches.filter(match => {
    for (const [unitId, qty] of match.covered_units) {
      const available = remaining.get(unitId)
      if (!available || available.quantity < qty) return false
    }
    return true
  }).map(match => {
    // Recalculate leftover for this remaining pool
    const leftover = new Map<string, number>()
    for (const [unitId, entry] of remaining) {
      const consumed = match.covered_units.get(unitId) ?? 0
      const left = entry.quantity - consumed
      if (left > 0) leftover.set(unitId, left)
    }
    return { ...match, leftover_units: leftover }
  })
}

/**
 * Pick the match that covers the most total units (by quantity sum).
 * Among ties, prefer higher specificity, then smaller volume, then lower cost.
 */
function pickBestCoverage(ranked: PackagingMatch[]): PackagingMatch {
  let best = ranked[0]
  let bestCoverage = totalCoverage(best.covered_units)

  for (let i = 1; i < ranked.length; i++) {
    const cov = totalCoverage(ranked[i].covered_units)
    if (cov > bestCoverage) {
      best = ranked[i]
      bestCoverage = cov
    } else if (cov === bestCoverage) {
      // Tie-break: use ranking criteria (already sorted by specificity, volume, cost)
      // So the first one in the ranked list wins
      break
    }
  }

  return best
}

function totalCoverage(covered: Map<string, number>): number {
  let total = 0
  for (const qty of covered.values()) {
    total += qty
  }
  return total
}

/**
 * Build a product list for a box based on which shipping units it covers.
 */
export function buildProductList(
  coveredUnits: Map<string, number>,
  availableUnits: Map<string, ShippingUnitEntry>,
  products: OrderProduct[],
  mixableMap: Map<number, { is_mixable: boolean; shipping_unit_id: string | null; weight: number; productcode: string }>
): { productcode: string; shipping_unit_name: string; quantity: number }[] {
  const result: { productcode: string; shipping_unit_name: string; quantity: number }[] = []

  // For each covered shipping unit, find products that belong to it
  for (const [unitId, coveredQty] of coveredUnits) {
    const unitEntry = availableUnits.get(unitId)
    const unitName = unitEntry?.name || 'Unknown'

    let remainingQty = coveredQty

    for (const product of products) {
      if (remainingQty <= 0) break

      const attrs = mixableMap.get(product.picqer_product_id)
      if (!attrs || attrs.shipping_unit_id !== unitId) continue

      const qty = Math.min(remainingQty, product.quantity)
      if (qty > 0) {
        result.push({
          productcode: product.productcode,
          shipping_unit_name: unitName,
          quantity: qty,
        })
        remainingQty -= qty
      }
    }

    // If still remaining (e.g. from composition expansion), add generic entry
    if (remainingQty > 0) {
      result.push({
        productcode: '(composition parts)',
        shipping_unit_name: unitName,
        quantity: remainingQty,
      })
    }
  }

  return result
}

/**
 * Validate that each box's total weight doesn't exceed its max_weight.
 * Called from calculateAdvice with fresh product data.
 */
export async function validateWeightsForBoxes(
  boxes: AdviceBox[],
  products: OrderProduct[]
): Promise<boolean> {
  if (boxes.length === 0) return true

  // Fetch product weights
  const productIds = products.map(p => p.picqer_product_id)
  const { data: weightData } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, productcode, weight')
    .in('picqer_product_id', productIds)

  const weightMap = new Map<string, number>()
  for (const row of (weightData || [])) {
    weightMap.set(row.productcode, row.weight ?? 0)
  }

  // Fetch max_weight for each packaging
  const packagingIds = [...new Set(boxes.map(b => b.packaging_id))]
  const { data: pkgs } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, max_weight')
    .in('id', packagingIds)

  const maxWeightMap = new Map<string, number>()
  for (const pkg of (pkgs || [])) {
    maxWeightMap.set(pkg.id, pkg.max_weight ?? Infinity)
  }

  let allValid = true
  for (const box of boxes) {
    const maxWeight = maxWeightMap.get(box.packaging_id) ?? Infinity
    if (maxWeight === Infinity) continue

    let totalWeight = 0
    for (const bp of box.products) {
      totalWeight += (weightMap.get(bp.productcode) ?? 0) * bp.quantity
    }

    if (totalWeight > maxWeight) {
      console.log(`[packagingEngine] Weight exceeded for ${box.packaging_name}: ${totalWeight}g > ${maxWeight}g`)
      allValid = false
    }
  }

  return allValid
}

// ── Helper: build alternatives from ranked matches ────────────────────────

/**
 * Build a list of alternative single-box packagings from the ranked matches.
 * Filters to only full matches (leftover_units.size === 0), deduplicates by packaging_id
 * (keeps the lowest-cost rule_group per packaging), and marks recommended + cheapest.
 *
 * @param ranked - The ranked PackagingMatch[] from rankPackagings()
 * @param recommendedPackagingId - The packaging_id that the engine actually chose
 */
export function buildAlternatives(
  ranked: PackagingMatch[],
  recommendedPackagingId: string | null
): AlternativePackaging[] {
  // Only single-box solutions (everything fits in one box)
  const singleBox = ranked.filter(m => m.leftover_units.size === 0)
  if (singleBox.length === 0) return []

  // Deduplicate by packaging_id: keep the first (best-ranked) per packaging
  const seen = new Set<string>()
  const unique: PackagingMatch[] = []
  for (const m of singleBox) {
    if (!seen.has(m.packaging_id)) {
      seen.add(m.packaging_id)
      unique.push(m)
    }
  }

  if (unique.length <= 1) return [] // Nothing to compare

  // Find cheapest (lowest total_cost among those with cost data)
  const withCost = unique.filter(m => m.total_cost > 0)
  const cheapestCost = withCost.length > 0
    ? Math.min(...withCost.map(m => m.total_cost))
    : null

  return unique.map(m => ({
    packaging_id: m.packaging_id,
    name: m.packaging_name,
    idpackaging: m.idpackaging,
    box_cost: m.box_cost || undefined,
    box_pick_cost: m.box_pick_cost || undefined,
    box_pack_cost: m.box_pack_cost || undefined,
    transport_cost: m.transport_cost || undefined,
    total_cost: m.total_cost || undefined,
    carrier_code: m.carrier_code ?? undefined,
    is_recommended: m.packaging_id === recommendedPackagingId,
    is_cheapest: cheapestCost !== null && m.total_cost === cheapestCost,
  }))
}

/**
 * Fallback: when matchCompartments returns 0 (no full rule group match),
 * find all packagings that reference any of the order's shipping units
 * in at least one compartment rule. Enrich with cost data for comparison.
 */
export async function buildAlternativesByShippingUnit(
  shippingUnits: Map<string, ShippingUnitEntry>,
  recommendedPackagingId: string | null,
  costMap: Map<string, CostEntry[]> | null
): Promise<AlternativePackaging[]> {
  const unitIds = Array.from(shippingUnits.keys())
  if (unitIds.length === 0) return []

  // Find packagings that have at least one rule referencing these shipping units
  const { data: candidates } = await supabase
    .schema('batchmaker')
    .from('compartment_rules')
    .select('packaging_id')
    .in('shipping_unit_id', unitIds)
    .eq('is_active', true)

  if (!candidates || candidates.length === 0) return []

  const candidateIds = [...new Set(candidates.map(c => c.packaging_id))]

  // Include the recommended packaging even if it has no rules for this unit
  if (recommendedPackagingId && !candidateIds.includes(recommendedPackagingId)) {
    candidateIds.push(recommendedPackagingId)
  }

  const { data: pkgs } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, idpackaging, name, facturatie_box_sku, picqer_tag_name, active, use_in_auto_advice')
    .in('id', candidateIds)
    .eq('active', true)

  if (!pkgs || pkgs.length === 0) return []

  // Enrich with costs, build alternatives
  const alts: AlternativePackaging[] = []
  for (const pkg of pkgs) {
    const displayName = pkg.picqer_tag_name || pkg.name
    let boxCost: number | undefined
    let boxPickCost: number | undefined
    let boxPackCost: number | undefined
    let transportCost: number | undefined
    let totalCost: number | undefined
    let carrierCode: string | undefined

    if (costMap && pkg.facturatie_box_sku) {
      const entries = costMap.get(pkg.facturatie_box_sku)
      if (entries && entries.length > 0) {
        const entry = entries.find(e => e.weightBracket === null) ?? entries[0]
        boxCost = entry.boxCost
        boxPickCost = entry.boxPickCost
        boxPackCost = entry.boxPackCost
        transportCost = entry.transportCost
        totalCost = entry.totalCost
        carrierCode = entry.carrier
      } else {
        continue // No cost data for this SKU → exclude
      }
    } else if (costMap && !pkg.facturatie_box_sku) {
      continue // Has cost data but no SKU mapping → exclude
    }

    alts.push({
      packaging_id: pkg.id,
      name: displayName,
      idpackaging: pkg.idpackaging,
      box_cost: boxCost,
      box_pick_cost: boxPickCost,
      box_pack_cost: boxPackCost,
      transport_cost: transportCost,
      total_cost: totalCost,
      carrier_code: carrierCode,
      is_recommended: pkg.id === recommendedPackagingId,
      is_cheapest: false, // Will be set below
    })
  }

  if (alts.length <= 1) return []

  // Sort by total_cost ASC
  alts.sort((a, b) => (a.total_cost ?? Infinity) - (b.total_cost ?? Infinity))

  // Mark cheapest
  const withCost = alts.filter(a => a.total_cost !== undefined && a.total_cost > 0)
  if (withCost.length > 0) {
    const cheapest = withCost[0].total_cost
    for (const a of alts) {
      a.is_cheapest = a.total_cost === cheapest
    }
  }

  return alts
}

// ── Helper: build shipping unit fingerprint ───────────────────────────────

export function buildFingerprint(shippingUnits: Map<string, ShippingUnitEntry>, countryCode: string): string {
  const units = Array.from(shippingUnits.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => `${u.name}:${u.quantity}`)
    .join('|')
  return `${countryCode}|${units}`
}

// ── 5. calculateAdvice ────────────────────────────────────────────────────

export async function calculateAdvice(
  orderId: number,
  picklistId?: number,
  products?: OrderProduct[],
  shippingProviderProfileId?: number,
  countryCode?: string
): Promise<PackagingAdviceResult> {
  if (!products || products.length === 0) {
    throw new Error('Products must be provided to calculate packaging advice')
  }

  console.log(`[packagingEngine] Calculating advice for order ${orderId} with ${products.length} products...`)

  // Step 1: Classify (for fingerprint-based cache check)
  const { shippingUnits } = await classifyOrderProducts(products)

  // Step 2: Build fingerprint for dedup
  const effectiveCountry = countryCode ?? 'UNKNOWN'
  const fingerprint = shippingUnits.size > 0 ? buildFingerprint(shippingUnits, effectiveCountry) : null

  // Step 3: Check for existing advice (dedup by fingerprint)
  const { data: existing } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('id, shipping_unit_fingerprint, confidence, advice_boxes, shipping_units_detected, unclassified_products, tags_written, calculated_at, status, weight_exceeded, cost_data_available')
    .eq('order_id', orderId)
    .not('status', 'eq', 'invalidated')
    .order('calculated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const sameFingerprint = existing.shipping_unit_fingerprint === fingerprint

    if (sameFingerprint) {
      console.log(`[packagingEngine] Returning existing advice ${existing.id} (same fingerprint)`)

      // Recompute alternatives + reasoning on-the-fly (not persisted) via coreAdvice
      const result = await coreAdvice({ products, countryCode: effectiveCountry })

      return {
        id: existing.id,
        order_id: orderId,
        picklist_id: picklistId ?? null,
        status: existing.status,
        confidence: existing.confidence,
        advice_boxes: existing.advice_boxes as AdviceBox[],
        alternatives: result.alternatives,
        shipping_units_detected: existing.shipping_units_detected as { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[],
        unclassified_products: existing.unclassified_products as string[],
        tags_written: existing.tags_written as string[],
        calculated_at: existing.calculated_at,
        weight_exceeded: existing.weight_exceeded ?? false,
        shipping_unit_fingerprint: fingerprint,
        cost_data_available: existing.cost_data_available ?? false,
        reasoning: result.reasoning,
      }
    }

    // Different fingerprint → invalidate the old record
    await supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .update({ status: 'invalidated', invalidated_at: new Date().toISOString() })
      .eq('id', existing.id)
    console.log(`[packagingEngine] Invalidated old advice ${existing.id} (fingerprint changed)`)
  }

  // Step 4: No cache hit — compute advice via coreAdvice
  const result = await coreAdvice({ products, countryCode: effectiveCountry })

  // Step 5: Persist to packaging_advice table
  const adviceRow = {
    order_id: orderId,
    picklist_id: picklistId ?? null,
    status: 'calculated' as const,
    confidence: result.confidence,
    advice_boxes: result.advice_boxes,
    shipping_units_detected: result.shipping_units_detected,
    unclassified_products: result.unclassified_products,
    tags_written: [],
    calculated_at: new Date().toISOString(),
    shipping_unit_fingerprint: result.cache_fingerprint,
    shipping_provider_profile_id: shippingProviderProfileId ?? null,
    weight_exceeded: result.weight_exceeded,
    country_code: countryCode ?? null,
    cost_data_available: result.cost_data_available,
    reasoning: result.reasoning,
  }

  const { data: inserted, error: insertError } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .insert(adviceRow)
    .select('id, order_id, picklist_id, status, confidence, advice_boxes, shipping_units_detected, unclassified_products, tags_written, calculated_at, weight_exceeded, shipping_unit_fingerprint, cost_data_available')
    .single()

  if (insertError) {
    console.error('[packagingEngine] Error inserting packaging_advice:', insertError)
    throw new Error(`Failed to save packaging advice: ${insertError.message}`)
  }

  console.log(`[packagingEngine] Advice calculated and saved: ${inserted.id} (confidence: ${result.confidence}, boxes: ${result.advice_boxes.length}, weight_exceeded: ${result.weight_exceeded})`)

  return {
    id: inserted.id,
    order_id: inserted.order_id,
    picklist_id: inserted.picklist_id,
    status: inserted.status,
    confidence: inserted.confidence,
    advice_boxes: inserted.advice_boxes as AdviceBox[],
    alternatives: result.alternatives,
    shipping_units_detected: inserted.shipping_units_detected as { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[],
    unclassified_products: inserted.unclassified_products as string[],
    tags_written: inserted.tags_written as string[],
    calculated_at: inserted.calculated_at,
    weight_exceeded: inserted.weight_exceeded ?? false,
    shipping_unit_fingerprint: inserted.shipping_unit_fingerprint ?? null,
    cost_data_available: inserted.cost_data_available ?? false,
    reasoning: result.reasoning,
  }
}

// ── 6. applyTags ──────────────────────────────────────────────────────────

export async function applyTags(
  orderId: number,
  adviceId: string
): Promise<string[]> {
  console.log(`[packagingEngine] Applying tags for order ${orderId}, advice ${adviceId}...`)

  // Read the advice
  const { data: advice, error: adviceError } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('id, advice_boxes, confidence, status')
    .eq('id', adviceId)
    .single()

  if (adviceError || !advice) {
    throw new Error(`Packaging advice not found: ${adviceId}`)
  }

  if (advice.confidence === 'no_match') {
    console.log('[packagingEngine] Advice is no_match — not writing any tags')
    return []
  }

  const adviceBoxes = advice.advice_boxes as AdviceBox[]
  if (!adviceBoxes || adviceBoxes.length === 0) {
    console.log('[packagingEngine] No advice boxes — not writing any tags')
    return []
  }

  // Get current order tags from Picqer
  const currentTags = await getOrderTags(orderId)

  // Remove existing C- prefixed tags (box-type tags from previous advice)
  const cTags = currentTags.filter(t => t.title.startsWith('C-'))
  for (const tag of cTags) {
    try {
      await removeOrderTag(orderId, tag.idtag)
      console.log(`[packagingEngine] Removed old tag: ${tag.title} (${tag.idtag})`)
    } catch (err) {
      console.error(`[packagingEngine] Failed to remove tag ${tag.title}:`, err)
    }
  }

  // Build new tag names from advice boxes
  // Count duplicates: if 2 boxes use the same packaging, we need "C-BoxName" and "C-BoxName (2)"
  const tagNameCounts = new Map<string, number>()
  const tagNames: string[] = []

  for (const box of adviceBoxes) {
    const baseName = `C-${box.packaging_name}`
    const count = (tagNameCounts.get(baseName) ?? 0) + 1
    tagNameCounts.set(baseName, count)
    tagNames.push(count > 1 ? `${baseName} (${count})` : baseName)
  }

  // Get all existing tags from Picqer to find IDs for our tag names
  const allPicqerTags = await getTags()
  const tagLookup = new Map<string, number>() // title -> idtag
  for (const t of allPicqerTags) {
    tagLookup.set(t.title, t.idtag)
  }

  // Add new tags
  const tagsWritten: string[] = []

  for (const tagName of tagNames) {
    const tagId = tagLookup.get(tagName)

    if (!tagId) {
      console.log(`[packagingEngine] Tag "${tagName}" does not exist in Picqer — skipping (must be created first)`)
      continue
    }

    try {
      await addOrderTag(orderId, tagId)
      tagsWritten.push(tagName)
      console.log(`[packagingEngine] Added tag: ${tagName} (${tagId})`)
    } catch (err) {
      console.error(`[packagingEngine] Failed to add tag ${tagName}:`, err)
    }
  }

  // Update the advice record
  const { error: updateError } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .update({
      status: 'applied',
      applied_at: new Date().toISOString(),
      tags_written: tagsWritten,
    })
    .eq('id', adviceId)

  if (updateError) {
    console.error('[packagingEngine] Error updating advice status:', updateError)
    // Non-fatal: tags were already written to Picqer
  }

  console.log(`[packagingEngine] Applied ${tagsWritten.length} tags to order ${orderId}`)
  return tagsWritten
}

// ── 7. previewAdvice (dry-run, no persistence) ───────────────────────────

export interface PreviewAdviceResult {
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: AdviceBox[]
  alternatives: AlternativePackaging[]
  all_matches: {
    packaging_id: string
    packaging_name: string
    idpackaging: number
    facturatie_box_sku: string | null
    rule_group: number
    specificity_score: number
    volume: number
    box_cost: number
    box_pick_cost: number
    box_pack_cost: number
    transport_cost: number
    total_cost: number
    carrier_code: string | null
    max_weight: number
    covers_all: boolean
  }[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  excluded_packaging: string[]
  excluded_non_shippable: string[]
  weight_exceeded: boolean
  cost_data_available: boolean
  country_code: string
  // Single-SKU fast path info
  is_single_sku: boolean
  default_packaging: {
    packaging_id: string
    packaging_name: string
    idpackaging: number
    facturatie_box_sku: string | null
  } | null
}

/**
 * Preview engine advice without any side-effects.
 * Does NOT: insert into packaging_advice, write tags to Picqer, invalidate existing advice.
 * Thin wrapper around coreAdvice().
 */
export async function previewAdvice(
  products: OrderProduct[],
  countryCode: string
): Promise<PreviewAdviceResult> {
  const result = await coreAdvice({ products, countryCode })

  // Map CoreAdviceResult to PreviewAdviceResult
  // Keep the PreviewAdviceResult interface unchanged for backward compatibility
  return {
    confidence: result.confidence,
    advice_boxes: result.advice_boxes,
    alternatives: result.alternatives,
    all_matches: [],  // No longer computed separately — callers don't rely on this
    shipping_units_detected: result.shipping_units_detected,
    unclassified_products: result.unclassified_products,
    excluded_packaging: result.excluded_packaging,
    excluded_non_shippable: result.excluded_non_shippable,
    weight_exceeded: result.weight_exceeded,
    cost_data_available: result.cost_data_available,
    country_code: countryCode,
    is_single_sku: result.is_single_sku,
    default_packaging: result.default_packaging,
  }
}
