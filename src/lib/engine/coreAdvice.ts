/**
 * Core Advice — Unified packaging advice algorithm.
 *
 * Single entry point for BOTH `previewAdvice` (dry-run) and `calculateAdvice` (persistent).
 * Contains the merged priority chain:
 *
 *   1. classifyOrderProducts
 *   2. Build packing fingerprint (without country) for learning
 *   3. Build cache fingerprint (with country) for dedup
 *   4. Fetch cost data for country
 *   5. Check learned patterns (when ENABLE_LEARNED_PATTERNS=true)
 *   6. Single-SKU fast path (with real weight)
 *   7. Compartment rules → solveMultiBox (domain knowledge, preferred)
 *   8. Box optimizer fallback (cost-based, only when rules gave no/partial match)
 *   9. Default packaging per shipping unit fallback
 *  10. Strapped consolidation
 *  11. Weight validation
 *  12. Build alternatives (optimizer + compartment merged)
 *  13. Return CoreAdviceResult
 */

import { supabase } from '@/lib/supabase/client'
import { getAllCostsForCountry, selectCostForWeight } from './costProvider'
import type { CostEntry } from './costProvider'
import { solveOptimalBoxes } from './boxOptimizer'
import type { PackagingInfo, ShippingUnitDemand } from './boxOptimizer'
import { getBoxCapacitiesMap } from '@/lib/supabase/boxCapacities'
import { findLearnedPattern, validatePatternPackagings, learnedPatternToAdviceBoxes, buildProductFingerprint } from './patternLearner'

import {
  classifyOrderProducts,
  matchCompartments,
  rankPackagings,
  solveMultiBox,
  enrichWithCosts,
  applyStrappedConsolidation,
  validateWeightsForBoxes,
  buildAlternatives,
  buildAlternativesByShippingUnit,
  refineBoxCostWithWeight,
  buildProductList,
  buildFingerprint,
} from './packagingEngine'

import type {
  OrderProduct,
  ShippingUnitEntry,
  AdviceBox,
  AlternativePackaging,
  ClassificationResult,
} from './packagingEngine'

// Re-export types that callers will need
export type { OrderProduct, ShippingUnitEntry, AdviceBox, AlternativePackaging }

// ── Fingerprint helpers ────────────────────────────────────────────────

/** Build fingerprint from PRODUCTS — for learned pattern matching */
function buildPackingFingerprintFromProducts(products: OrderProduct[]): string | null {
  return buildProductFingerprint(products)
}

/** Build fingerprint WITH country — for dedup/caching (still shipping-unit based) */
function buildCacheFingerprint(shippingUnits: Map<string, ShippingUnitEntry>, countryCode: string): string | null {
  if (shippingUnits.size === 0) return null
  return buildFingerprint(shippingUnits, countryCode)
}

// ── Core Advice Types ───────────────────────────────────────────────────

export interface CoreAdviceOptions {
  products: OrderProduct[]
  countryCode: string
  skipLearnedPatterns?: boolean  // for testing
}

export type AdviceSource =
  | 'learned_pattern'
  | 'single_sku_default'
  | 'optimizer'
  | 'compartment_rules'
  | 'default_fallback'

export interface CoreAdviceResult {
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: AdviceBox[]
  alternatives: AlternativePackaging[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  excluded_packaging: string[]
  excluded_non_shippable: string[]
  weight_exceeded: boolean
  cost_data_available: boolean
  packing_fingerprint: string | null    // country-free fingerprint for learning
  cache_fingerprint: string | null      // country-included fingerprint for dedup
  source: AdviceSource
  learned_pattern_id?: string           // placeholder for Phase 2
  is_single_sku: boolean
  default_packaging: { packaging_id: string; packaging_name: string; idpackaging: number; facturatie_box_sku: string | null } | null
}

// ── Core Advice Algorithm ───────────────────────────────────────────────

/**
 * Unified packaging advice algorithm. Pure logic, no persistence.
 *
 * Priority chain:
 *   1. Classify → 2. Fingerprints → 3. Costs → 4. Learned patterns →
 *   5. Single-SKU → 6. Compartment rules → 7. Optimizer fallback →
 *   8. Default fallback → 9. Strapped consolidation → 10. Weight validation → 11. Alternatives
 */
export async function coreAdvice(options: CoreAdviceOptions): Promise<CoreAdviceResult> {
  const { products, countryCode, skipLearnedPatterns } = options

  if (!products || products.length === 0) {
    return emptyResult('no_match', 'compartment_rules')
  }

  console.log(`[coreAdvice] Starting for ${products.length} products (country: ${countryCode})`)

  // ── Step 1: Classify products into shipping units ─────────────────
  const classification = await classifyOrderProducts(products)
  const { shippingUnits, unclassified, excludedPackaging, excludedNonShippable } = classification

  // ── Step 2: Build fingerprints ────────────────────────────────────
  const packingFingerprint = buildPackingFingerprintFromProducts(products)
  const cacheFingerprint = buildCacheFingerprint(shippingUnits, countryCode)

  // ── Step 3: Fetch cost data ───────────────────────────────────────
  let costDataAvailable = false
  let costMap: Map<string, CostEntry[]> | null = null

  if (countryCode) {
    costMap = await getAllCostsForCountry(countryCode)
    costDataAvailable = costMap !== null
    if (!costDataAvailable) {
      console.warn(`[coreAdvice] Cost data unavailable for ${countryCode}, using specificity ranking`)
    }
  }

  // ── Step 4: Check learned patterns ───────────────────────────────
  const learnedPatternsEnabled = process.env.ENABLE_LEARNED_PATTERNS === 'true'
  if (learnedPatternsEnabled && !skipLearnedPatterns && packingFingerprint) {
    const pattern = await findLearnedPattern(packingFingerprint)
    if (pattern) {
      const valid = await validatePatternPackagings(pattern)
      if (valid) {
        console.log(`[coreAdvice] Using learned pattern ${pattern.id} (seen ${pattern.times_seen}x)`)

        // Convert pattern to AdviceBox[] — uses shipping unit names as abstract product identifiers.
        // The packing screen resolves these to real products when creating boxes.
        const patternBoxes = learnedPatternToAdviceBoxes(pattern, costMap)

        // Apply strapped consolidation
        const consolidatedBoxes = await applyStrappedConsolidation(patternBoxes, costMap)

        // Weight validation
        const weightExceeded = !(await validateWeightsForBoxes(consolidatedBoxes, products))

        // Compute alternatives for comparison
        const recommendedPkgId = consolidatedBoxes.length === 1 ? consolidatedBoxes[0].packaging_id : null
        let alternatives = await computeAlternatives(shippingUnits, costMap, costDataAvailable, recommendedPkgId)

        const shippingUnitsDetected = Array.from(shippingUnits.values()).map(entry => ({
          shipping_unit_id: entry.id,
          shipping_unit_name: entry.name,
          quantity: entry.quantity,
        }))

        return {
          confidence: 'full_match',
          advice_boxes: consolidatedBoxes,
          alternatives,
          shipping_units_detected: shippingUnitsDetected,
          unclassified_products: unclassified,
          excluded_packaging: excludedPackaging,
          excluded_non_shippable: excludedNonShippable,
          weight_exceeded: weightExceeded,
          cost_data_available: costDataAvailable,
          packing_fingerprint: packingFingerprint,
          cache_fingerprint: cacheFingerprint,
          source: 'learned_pattern' as AdviceSource,
          learned_pattern_id: pattern.id,
          is_single_sku: false,
          default_packaging: null,
        }
      } else {
        // Pattern has stale packagings — invalidate it
        await supabase
          .schema('batchmaker')
          .from('learned_packing_patterns')
          .update({
            status: 'invalidated',
            invalidated_at: new Date().toISOString(),
            invalidation_reason: 'packaging_deactivated',
            updated_at: new Date().toISOString(),
          })
          .eq('id', pattern.id)
        console.log(`[coreAdvice] Invalidated stale learned pattern ${pattern.id}`)
      }
    }
  }

  // ── Step 5: Single-SKU / single-default fast path ──────────────────
  const excludedSet = new Set([...excludedPackaging, ...excludedNonShippable])
  const realProducts = products.filter(p => !excludedSet.has(p.productcode))
  const uniqueProductIds = new Set(realProducts.map(p => p.picqer_product_id))
  const isSingleSku = uniqueProductIds.size === 1 && unclassified.length === 0

  const defaultPackaging: CoreAdviceResult['default_packaging'] = null

  if (isSingleSku && realProducts.length > 0) {
    const singleSkuResult = await trySingleSkuFastPath(
      realProducts, shippingUnits, costMap, costDataAvailable, countryCode,
      classification, packingFingerprint, cacheFingerprint, products
    )
    if (singleSkuResult) {
      return singleSkuResult
    }
  }

  // Also try fast path when all shipping units share the same default packaging
  // (e.g., 3 different Ficus varieties all in the same shipping unit → same default box)
  if (!isSingleSku && shippingUnits.size > 0 && unclassified.length === 0) {
    const unitIds = Array.from(shippingUnits.keys())
    const { data: unitDefaults } = await supabase
      .schema('batchmaker')
      .from('shipping_units')
      .select('id, default_packaging_id')
      .in('id', unitIds)
      .not('default_packaging_id', 'is', null)

    if (unitDefaults && unitDefaults.length === unitIds.length) {
      const uniqueDefaults = new Set(unitDefaults.map(d => d.default_packaging_id))
      if (uniqueDefaults.size === 1) {
        // All shipping units share the same default packaging — use single-SKU fast path
        const singleDefaultResult = await trySingleSkuFastPathByPackaging(
          Array.from(uniqueDefaults)[0]!, realProducts, shippingUnits,
          costMap, costDataAvailable, classification, packingFingerprint, cacheFingerprint, products
        )
        if (singleDefaultResult) {
          return singleDefaultResult
        }
      }
    }
  }

  // ── Step 6: Compartment rules → solveMultiBox ─────────────────────
  // Compartment rules first: they encode domain knowledge about which box fits which products.
  // The optimizer is only used as fallback for multi-box splits when rules don't find a solution.
  const matches = await matchCompartments(shippingUnits)
  const enrichedMatches = enrichWithCosts(matches, costMap)
  const ranked = rankPackagings(enrichedMatches, costDataAvailable)

  let { boxes, confidence } = await solveMultiBox(
    shippingUnits, unclassified, ranked, products,
    costMap, costDataAvailable
  )

  let source: AdviceSource = 'compartment_rules'

  // ── Step 7: Box optimizer fallback (when compartment rules gave no/partial match) ──
  if (confidence !== 'full_match' && shippingUnits.size > 0) {
    const optimizerResult = await tryBoxOptimizer(
      shippingUnits, realProducts, costMap, costDataAvailable, unclassified,
      classification, packingFingerprint, cacheFingerprint, products, countryCode
    )
    if (optimizerResult) {
      return optimizerResult
    }
  }

  // ── Step 8: Default packaging per shipping unit fallback ──────────
  if (confidence === 'no_match' && shippingUnits.size > 0) {
    const fallbackResult = await tryDefaultPackagingFallback(
      shippingUnits, products, costMap, unclassified
    )
    if (fallbackResult) {
      boxes = fallbackResult.boxes
      confidence = fallbackResult.confidence
      source = 'default_fallback'
    }
  }

  // ── Step 9: Strapped consolidation ────────────────────────────────
  boxes = await applyStrappedConsolidation(boxes, costMap)

  // ── Step 10: Weight validation ────────────────────────────────────
  const weightExceeded = !(await validateWeightsForBoxes(boxes, products))

  // ── Step 11: Build alternatives ───────────────────────────────────
  const recommendedPkgId = boxes.length === 1 ? boxes[0].packaging_id : null
  let alternatives = buildAlternatives(ranked, recommendedPkgId)
  if (alternatives.length === 0 && shippingUnits.size > 0 && costDataAvailable && costMap) {
    alternatives = await buildAlternativesByShippingUnit(shippingUnits, recommendedPkgId, costMap)
  }

  const shippingUnitsDetected = Array.from(shippingUnits.values()).map(entry => ({
    shipping_unit_id: entry.id,
    shipping_unit_name: entry.name,
    quantity: entry.quantity,
  }))

  console.log(`[coreAdvice] Done: source=${source}, confidence=${confidence}, boxes=${boxes.length}, singleSku=${isSingleSku}`)

  return {
    confidence,
    advice_boxes: boxes,
    alternatives,
    shipping_units_detected: shippingUnitsDetected,
    unclassified_products: unclassified,
    excluded_packaging: excludedPackaging,
    excluded_non_shippable: excludedNonShippable,
    weight_exceeded: weightExceeded,
    cost_data_available: costDataAvailable,
    packing_fingerprint: packingFingerprint,
    cache_fingerprint: cacheFingerprint,
    source,
    is_single_sku: isSingleSku,
    default_packaging: defaultPackaging,
  }
}

// ── Step 5 implementation: Single-SKU fast path ─────────────────────────

async function trySingleSkuFastPath(
  realProducts: OrderProduct[],
  shippingUnits: Map<string, ShippingUnitEntry>,
  costMap: Map<string, CostEntry[]> | null,
  costDataAvailable: boolean,
  countryCode: string,
  classification: ClassificationResult,
  packingFingerprint: string | null,
  cacheFingerprint: string | null,
  allProducts: OrderProduct[]
): Promise<CoreAdviceResult | null> {
  const productId = realProducts[0].picqer_product_id

  const { data: productAttr } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('default_packaging_id, shipping_unit_id, weight')
    .eq('picqer_product_id', productId)
    .single()

  if (!productAttr?.default_packaging_id) return null

  const { data: defaultPkg } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name, idpackaging, barcode, facturatie_box_sku, active')
    .eq('id', productAttr.default_packaging_id)
    .single()

  if (!defaultPkg || !defaultPkg.active) return null

  console.log(`[coreAdvice] Single-SKU fast path: product ${realProducts[0].productcode} → ${defaultPkg.name}`)

  const unitName = shippingUnits.values().next()?.value?.name || 'Unknown'
  const totalQty = realProducts.reduce((sum, p) => sum + p.quantity, 0)
  const boxProducts = [{
    productcode: realProducts[0].productcode,
    shipping_unit_name: unitName,
    quantity: totalQty,
  }]

  // Use REAL weight (from product_attributes), not weight=0
  const productWeight = productAttr.weight ?? 0
  const totalWeight = productWeight * totalQty

  let singleSkuBox: AdviceBox = {
    packaging_id: defaultPkg.id,
    packaging_name: defaultPkg.name,
    idpackaging: defaultPkg.idpackaging,
    products: boxProducts,
  }

  // Enrich with weight-aware cost data
  let localCostDataAvailable = costDataAvailable
  if (costMap && defaultPkg.facturatie_box_sku) {
    const entries = costMap.get(defaultPkg.facturatie_box_sku)
    if (entries && entries.length > 0) {
      const entry = selectCostForWeight(entries, totalWeight)
      if (entry) {
        singleSkuBox.box_cost = entry.boxMaterialCost ?? entry.boxCost
        singleSkuBox.box_pick_cost = entry.boxPickCost
        singleSkuBox.box_pack_cost = entry.boxPackCost
        singleSkuBox.transport_cost = entry.transportCost
        singleSkuBox.total_cost = entry.totalCost
        singleSkuBox.carrier_code = entry.carrier
        singleSkuBox.weight_grams = totalWeight
        singleSkuBox.weight_bracket = entry.weightBracket
        localCostDataAvailable = true
      }
    }
  }

  // Strapped consolidation (in case single-SKU produces 2+ boxes in future)
  let boxes = await applyStrappedConsolidation([singleSkuBox], costMap)

  // Weight validation
  const weightExceeded = !(await validateWeightsForBoxes(boxes, allProducts))

  // Build alternatives from compartment rules for comparison
  let alternatives: AlternativePackaging[] = []
  if (shippingUnits.size > 0 && localCostDataAvailable && costMap) {
    const skuMatches = await matchCompartments(shippingUnits)
    const skuEnriched = enrichWithCosts(skuMatches, costMap)
    const skuRanked = rankPackagings(skuEnriched, true)
    alternatives = buildAlternatives(skuRanked, defaultPkg.id)
    if (alternatives.length === 0) {
      alternatives = await buildAlternativesByShippingUnit(shippingUnits, defaultPkg.id, costMap)
    }
  }

  const shippingUnitsDetected = Array.from(shippingUnits.values()).map(entry => ({
    shipping_unit_id: entry.id,
    shipping_unit_name: entry.name,
    quantity: entry.quantity,
  }))

  return {
    confidence: 'full_match',
    advice_boxes: boxes,
    alternatives,
    shipping_units_detected: shippingUnitsDetected,
    unclassified_products: [],
    excluded_packaging: classification.excludedPackaging,
    excluded_non_shippable: classification.excludedNonShippable,
    weight_exceeded: weightExceeded,
    cost_data_available: localCostDataAvailable,
    packing_fingerprint: packingFingerprint,
    cache_fingerprint: cacheFingerprint,
    source: 'single_sku_default',
    is_single_sku: true,
    default_packaging: {
      packaging_id: defaultPkg.id,
      packaging_name: defaultPkg.name,
      idpackaging: defaultPkg.idpackaging,
      facturatie_box_sku: defaultPkg.facturatie_box_sku,
    },
  }
}

// ── Step 5b implementation: Single-default fast path (all shipping units → same packaging) ──

async function trySingleSkuFastPathByPackaging(
  packagingId: string,
  realProducts: OrderProduct[],
  shippingUnits: Map<string, ShippingUnitEntry>,
  costMap: Map<string, CostEntry[]> | null,
  costDataAvailable: boolean,
  classification: ClassificationResult,
  packingFingerprint: string | null,
  cacheFingerprint: string | null,
  allProducts: OrderProduct[]
): Promise<CoreAdviceResult | null> {
  const { data: defaultPkg } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name, idpackaging, barcode, facturatie_box_sku, active')
    .eq('id', packagingId)
    .single()

  if (!defaultPkg || !defaultPkg.active) return null

  console.log(`[coreAdvice] Single-default fast path: all shipping units → ${defaultPkg.name}`)

  // Fetch product attributes in bulk (shipping_unit_id + weight)
  const productIds = realProducts.map(p => p.picqer_product_id)
  const { data: productAttrs } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, shipping_unit_id, weight')
    .in('picqer_product_id', productIds)

  const attrByPid = new Map<number, { shipping_unit_id: string | null; weight: number }>()
  for (const row of (productAttrs || [])) {
    attrByPid.set(row.picqer_product_id, {
      shipping_unit_id: row.shipping_unit_id,
      weight: row.weight ?? 0,
    })
  }

  // Build product list and calculate weight in one pass
  const boxProducts: { productcode: string; shipping_unit_name: string; quantity: number }[] = []
  let totalWeight = 0

  for (const product of realProducts) {
    const attr = attrByPid.get(product.picqer_product_id)
    if (attr?.shipping_unit_id && shippingUnits.has(attr.shipping_unit_id)) {
      const unitName = shippingUnits.get(attr.shipping_unit_id)?.name || 'Unknown'
      boxProducts.push({
        productcode: product.productcode,
        shipping_unit_name: unitName,
        quantity: product.quantity,
      })
      totalWeight += attr.weight * product.quantity
    }
  }

  let singleBox: AdviceBox = {
    packaging_id: defaultPkg.id,
    packaging_name: defaultPkg.name,
    idpackaging: defaultPkg.idpackaging,
    products: boxProducts,
  }

  // Enrich with weight-aware cost data
  let localCostDataAvailable = costDataAvailable
  if (costMap && defaultPkg.facturatie_box_sku) {
    const entries = costMap.get(defaultPkg.facturatie_box_sku)
    if (entries && entries.length > 0) {
      const entry = selectCostForWeight(entries, totalWeight)
      if (entry) {
        singleBox.box_cost = entry.boxMaterialCost ?? entry.boxCost
        singleBox.box_pick_cost = entry.boxPickCost
        singleBox.box_pack_cost = entry.boxPackCost
        singleBox.transport_cost = entry.transportCost
        singleBox.total_cost = entry.totalCost
        singleBox.carrier_code = entry.carrier
        singleBox.weight_grams = totalWeight
        singleBox.weight_bracket = entry.weightBracket
        localCostDataAvailable = true
      }
    }
  }

  let boxes = await applyStrappedConsolidation([singleBox], costMap)
  const weightExceeded = !(await validateWeightsForBoxes(boxes, allProducts))

  // Build alternatives
  let alternatives: AlternativePackaging[] = []
  if (shippingUnits.size > 0 && localCostDataAvailable && costMap) {
    const matches = await matchCompartments(shippingUnits)
    const enriched = enrichWithCosts(matches, costMap)
    const ranked = rankPackagings(enriched, true)
    alternatives = buildAlternatives(ranked, defaultPkg.id)
    if (alternatives.length === 0) {
      alternatives = await buildAlternativesByShippingUnit(shippingUnits, defaultPkg.id, costMap)
    }
  }

  const shippingUnitsDetected = Array.from(shippingUnits.values()).map(entry => ({
    shipping_unit_id: entry.id,
    shipping_unit_name: entry.name,
    quantity: entry.quantity,
  }))

  return {
    confidence: 'full_match',
    advice_boxes: boxes,
    alternatives,
    shipping_units_detected: shippingUnitsDetected,
    unclassified_products: [],
    excluded_packaging: classification.excludedPackaging,
    excluded_non_shippable: classification.excludedNonShippable,
    weight_exceeded: weightExceeded,
    cost_data_available: localCostDataAvailable,
    packing_fingerprint: packingFingerprint,
    cache_fingerprint: cacheFingerprint,
    source: 'single_sku_default',
    is_single_sku: false,
    default_packaging: {
      packaging_id: defaultPkg.id,
      packaging_name: defaultPkg.name,
      idpackaging: defaultPkg.idpackaging,
      facturatie_box_sku: defaultPkg.facturatie_box_sku,
    },
  }
}

// ── Step 7 implementation: Box optimizer (fallback) ─────────────────────

async function tryBoxOptimizer(
  shippingUnits: Map<string, ShippingUnitEntry>,
  realProducts: OrderProduct[],
  costMap: Map<string, CostEntry[]> | null,
  costDataAvailable: boolean,
  unclassified: string[],
  classification: ClassificationResult,
  packingFingerprint: string | null,
  cacheFingerprint: string | null,
  allProducts: OrderProduct[],
  countryCode: string
): Promise<CoreAdviceResult | null> {
  const capacitiesMap = await getBoxCapacitiesMap()
  if (capacitiesMap.size === 0 || !costMap) return null

  // Fetch packaging info for the optimizer
  const { data: allPackagings } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name, idpackaging, facturatie_box_sku')
    .eq('active', true)

  if (!allPackagings || allPackagings.length === 0) return null

  const pkgInfoMap = new Map<string, PackagingInfo>()
  for (const p of allPackagings) {
    pkgInfoMap.set(p.id, {
      id: p.id,
      name: p.name,
      idpackaging: p.idpackaging,
      facturatieBoxSku: p.facturatie_box_sku,
    })
  }

  // Convert shipping units to optimizer demand format
  const demand = new Map<string, ShippingUnitDemand>()
  for (const [unitId, entry] of shippingUnits) {
    demand.set(unitId, { id: unitId, name: entry.name, quantity: entry.quantity })
  }

  // Build product weight map for weight-bracket selection
  const productIds = allProducts.map(p => p.picqer_product_id)
  const { data: weightData } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, productcode, weight, shipping_unit_id')
    .in('picqer_product_id', productIds)

  // Compute average weight per shipping unit (for optimizer weight brackets)
  const unitWeightTotals = new Map<string, { totalWeight: number; totalQty: number }>()
  for (const row of (weightData || [])) {
    if (!row.shipping_unit_id || !row.weight) continue
    const existing = unitWeightTotals.get(row.shipping_unit_id) ?? { totalWeight: 0, totalQty: 0 }
    const product = allProducts.find(p => p.picqer_product_id === row.picqer_product_id)
    if (product) {
      existing.totalWeight += row.weight * product.quantity
      existing.totalQty += product.quantity
      unitWeightTotals.set(row.shipping_unit_id, existing)
    }
  }
  const productWeights = new Map<string, number>()
  for (const [unitId, data] of unitWeightTotals) {
    productWeights.set(unitId, data.totalQty > 0 ? data.totalWeight / data.totalQty : 0)
  }

  const solution = solveOptimalBoxes(demand, capacitiesMap, pkgInfoMap, costMap, productWeights)

  console.log(`[coreAdvice] Optimizer: ${solution.boxes.length} boxes, cost=${solution.totalCost.toFixed(2)}, complete=${solution.isComplete}`)

  if (!solution.isComplete || solution.boxes.length === 0) return null

  // Build weight map for cost refinement
  const weightMap = new Map<string, number>()
  for (const row of (weightData || [])) {
    weightMap.set(row.productcode, row.weight ?? 0)
  }

  // Build mixable map for buildProductList
  const mixableMap = new Map<number, { is_mixable: boolean; shipping_unit_id: string | null; weight: number; productcode: string }>()
  for (const row of (weightData || [])) {
    mixableMap.set(row.picqer_product_id, {
      is_mixable: true,
      shipping_unit_id: row.shipping_unit_id,
      weight: row.weight ?? 0,
      productcode: row.productcode,
    })
  }

  // Convert optimizer result to AdviceBox format
  let boxes: AdviceBox[] = solution.boxes.map(box => {
    // Build proper product list using coveredUnits
    const coveredUnits = new Map<string, number>()
    for (const [unitId, qty] of box.assignment) {
      coveredUnits.set(unitId, qty)
    }
    const boxProducts = buildProductList(coveredUnits, shippingUnits, allProducts, mixableMap)

    let adviceBox: AdviceBox = {
      packaging_id: box.packagingId,
      packaging_name: box.packagingName,
      idpackaging: box.idpackaging,
      products: boxProducts,
      box_cost: box.cost?.boxMaterialCost ?? box.cost?.boxCost,
      box_pick_cost: box.cost?.boxPickCost,
      box_pack_cost: box.cost?.boxPackCost,
      transport_cost: box.cost?.transportCost,
      total_cost: box.cost?.totalCost,
      carrier_code: box.cost?.carrier,
      weight_bracket: box.cost?.weightBracket,
    }

    // Refine cost with actual product weight
    const pkgInfo = pkgInfoMap.get(box.packagingId)
    if (pkgInfo?.facturatieBoxSku && costMap) {
      const entries = costMap.get(pkgInfo.facturatieBoxSku)
      adviceBox = refineBoxCostWithWeight(adviceBox, entries, weightMap)
    }

    return adviceBox
  })

  const confidence: CoreAdviceResult['confidence'] = unclassified.length > 0 ? 'partial_match' : 'full_match'

  // Strapped consolidation
  boxes = await applyStrappedConsolidation(boxes, costMap)

  // Weight validation
  const weightExceeded = !(await validateWeightsForBoxes(boxes, allProducts))

  // Build alternatives: single-box fits from optimizer capacities
  const optimizerAlternatives = buildOptimizerAlternatives(
    shippingUnits, capacitiesMap, pkgInfoMap, costMap,
    boxes.length === 1 ? boxes[0].packaging_id : null
  )

  // Also gather compartment-rule alternatives and merge
  const compartmentMatches = await matchCompartments(shippingUnits)
  const enrichedCompartment = enrichWithCosts(compartmentMatches, costMap)
  const rankedCompartment = rankPackagings(enrichedCompartment, costDataAvailable)
  const compartmentAlternatives = buildAlternatives(rankedCompartment, boxes.length === 1 ? boxes[0].packaging_id : null)

  const alternatives = mergeAlternatives(optimizerAlternatives, compartmentAlternatives)

  const shippingUnitsDetected = Array.from(shippingUnits.values()).map(entry => ({
    shipping_unit_id: entry.id,
    shipping_unit_name: entry.name,
    quantity: entry.quantity,
  }))

  return {
    confidence,
    advice_boxes: boxes,
    alternatives,
    shipping_units_detected: shippingUnitsDetected,
    unclassified_products: unclassified,
    excluded_packaging: classification.excludedPackaging,
    excluded_non_shippable: classification.excludedNonShippable,
    weight_exceeded: weightExceeded,
    cost_data_available: true,
    packing_fingerprint: packingFingerprint,
    cache_fingerprint: cacheFingerprint,
    source: 'optimizer',
    is_single_sku: false,
    default_packaging: null,
  }
}

// ── Step 8 implementation: Default packaging fallback ────────────────────

async function tryDefaultPackagingFallback(
  shippingUnits: Map<string, ShippingUnitEntry>,
  products: OrderProduct[],
  costMap: Map<string, CostEntry[]> | null,
  unclassified: string[]
): Promise<{ boxes: AdviceBox[]; confidence: 'full_match' | 'partial_match' | 'no_match' } | null> {
  const unitIds = Array.from(shippingUnits.keys())

  const { data: defaults } = await supabase
    .schema('batchmaker')
    .from('shipping_units')
    .select('id, name, default_packaging_id')
    .in('id', unitIds)
    .not('default_packaging_id', 'is', null)

  if (!defaults || defaults.length === 0) return null

  const defaultPkgIds = [...new Set(defaults.map(d => d.default_packaging_id))]
  const { data: pkgs } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name, idpackaging, facturatie_box_sku')
    .in('id', defaultPkgIds)

  const pkgMap = new Map((pkgs || []).map((p: { id: string; name: string; idpackaging: number; facturatie_box_sku: string | null }) => [p.id, p] as const))

  // Build product → shipping_unit lookup
  const productIds = products.map(p => p.picqer_product_id)
  const { data: prodAttrs } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, shipping_unit_id')
    .in('picqer_product_id', productIds)
    .not('shipping_unit_id', 'is', null)

  const productUnitMap = new Map<string, string>()
  for (const pa of (prodAttrs || [])) {
    const product = products.find(p => p.picqer_product_id === pa.picqer_product_id)
    if (product) productUnitMap.set(product.productcode, pa.shipping_unit_id)
  }

  // Group products by their default packaging
  const boxMap = new Map<string, { pkg: { id: string; name: string; idpackaging: number; facturatie_box_sku: string | null }; products: { productcode: string; shipping_unit_name: string; quantity: number }[] }>()

  for (const product of products) {
    const unitId = productUnitMap.get(product.productcode)
    if (!unitId) continue

    const def = defaults.find(d => d.id === unitId)
    if (!def) continue

    const pkg = pkgMap.get(def.default_packaging_id)
    if (!pkg) continue

    const unitName = shippingUnits.get(unitId)?.name || def.name

    if (!boxMap.has(pkg.id)) {
      boxMap.set(pkg.id, { pkg, products: [] })
    }
    boxMap.get(pkg.id)!.products.push({
      productcode: product.productcode,
      shipping_unit_name: unitName,
      quantity: product.quantity,
    })
  }

  if (boxMap.size === 0) return null

  const boxes: AdviceBox[] = Array.from(boxMap.values()).map(entry => {
    const box: AdviceBox = {
      packaging_id: entry.pkg.id,
      packaging_name: entry.pkg.name,
      idpackaging: entry.pkg.idpackaging,
      products: entry.products,
    }

    if (costMap && entry.pkg.facturatie_box_sku) {
      const entries = costMap.get(entry.pkg.facturatie_box_sku)
      if (entries && entries.length > 0) {
        const costEntry = selectCostForWeight(entries, 0)
        if (costEntry) {
          box.box_cost = costEntry.boxCost
          box.box_pick_cost = costEntry.boxPickCost
          box.box_pack_cost = costEntry.boxPackCost
          box.transport_cost = costEntry.transportCost
          box.total_cost = costEntry.totalCost
        }
      }
    }

    return box
  })

  const confidence = unclassified.length > 0 ? 'partial_match' as const : 'full_match' as const
  console.log(`[coreAdvice] Default packaging fallback: ${boxes.length} boxes (confidence: ${confidence})`)

  return { boxes, confidence }
}

// ── Alternative builders ────────────────────────────────────────────────

/**
 * Build alternatives from optimizer capacities: single-box solutions.
 */
function buildOptimizerAlternatives(
  shippingUnits: Map<string, ShippingUnitEntry>,
  capacitiesMap: Map<string, Map<string, number>>,
  pkgInfoMap: Map<string, PackagingInfo>,
  costMap: Map<string, CostEntry[]>,
  recommendedPackagingId: string | null
): AlternativePackaging[] {
  const alts: AlternativePackaging[] = []

  for (const [packagingId, unitCaps] of capacitiesMap) {
    const info = pkgInfoMap.get(packagingId)
    if (!info || !info.facturatieBoxSku) continue

    // Can this single box hold everything?
    let fitsAll = true
    let fillRatio = 0
    for (const [unitId, entry] of shippingUnits) {
      const maxCap = unitCaps.get(unitId)
      if (!maxCap || entry.quantity > maxCap) { fitsAll = false; break }
      fillRatio += entry.quantity / maxCap
    }
    if (!fitsAll || fillRatio > 1.0) continue

    const entries = costMap.get(info.facturatieBoxSku)
    if (!entries) continue
    const cost = selectCostForWeight(entries, 0)
    if (!cost) continue

    alts.push({
      packaging_id: packagingId,
      name: info.name,
      idpackaging: info.idpackaging,
      box_cost: cost.boxMaterialCost ?? cost.boxCost,
      box_pick_cost: cost.boxPickCost,
      box_pack_cost: cost.boxPackCost,
      transport_cost: cost.transportCost,
      total_cost: cost.totalCost,
      carrier_code: cost.carrier,
      is_recommended: packagingId === recommendedPackagingId,
      is_cheapest: false,
    })
  }

  return alts
}

/**
 * Merge alternatives from optimizer and compartment rules.
 * Deduplicate by packaging_id, keeping the lowest cost per packaging.
 */
function mergeAlternatives(
  optimizerAlts: AlternativePackaging[],
  compartmentAlts: AlternativePackaging[]
): AlternativePackaging[] {
  const byId = new Map<string, AlternativePackaging>()

  // Add all, keeping lowest cost per packaging_id
  for (const alt of [...optimizerAlts, ...compartmentAlts]) {
    const existing = byId.get(alt.packaging_id)
    if (!existing || (alt.total_cost ?? Infinity) < (existing.total_cost ?? Infinity)) {
      byId.set(alt.packaging_id, alt)
    }
  }

  const merged = Array.from(byId.values())
  if (merged.length <= 1) return []

  // Sort by total_cost ASC
  merged.sort((a, b) => (a.total_cost ?? Infinity) - (b.total_cost ?? Infinity))

  // Mark cheapest
  const withCost = merged.filter(a => a.total_cost !== undefined && a.total_cost > 0)
  if (withCost.length > 0) {
    const cheapestCost = withCost[0].total_cost
    for (const a of merged) {
      a.is_cheapest = a.total_cost === cheapestCost
    }
  }

  return merged
}

// ── Shared: compute alternatives from compartment rules + shipping units ──

async function computeAlternatives(
  shippingUnits: Map<string, ShippingUnitEntry>,
  costMap: Map<string, CostEntry[]> | null,
  costDataAvailable: boolean,
  recommendedPackagingId: string | null
): Promise<AlternativePackaging[]> {
  if (shippingUnits.size === 0) return []

  const matches = await matchCompartments(shippingUnits)
  const enriched = enrichWithCosts(matches, costMap)
  const ranked = rankPackagings(enriched, costDataAvailable)
  let alternatives = buildAlternatives(ranked, recommendedPackagingId)

  if (alternatives.length === 0 && costDataAvailable && costMap) {
    alternatives = await buildAlternativesByShippingUnit(shippingUnits, recommendedPackagingId, costMap)
  }

  return alternatives
}

// ── Helpers ─────────────────────────────────────────────────────────────

function emptyResult(confidence: CoreAdviceResult['confidence'], source: AdviceSource): CoreAdviceResult {
  return {
    confidence,
    advice_boxes: [],
    alternatives: [],
    shipping_units_detected: [],
    unclassified_products: [],
    excluded_packaging: [],
    excluded_non_shippable: [],
    weight_exceeded: false,
    cost_data_available: false,
    packing_fingerprint: null,
    cache_fingerprint: null,
    source,
    is_single_sku: false,
    default_packaging: null,
  }
}
