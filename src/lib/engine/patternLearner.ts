/**
 * Pattern Learner — Learn and recall packing patterns from completed sessions.
 *
 * Records how workers pack orders (which boxes, which products per box) and
 * builds a fingerprint-based lookup so future identical orders can reuse
 * proven packing configurations.
 *
 * Lifecycle: learning → active → (invalidated)
 *   - New patterns start as 'learning'
 *   - After PROMOTION_THRESHOLD consistent observations, promoted to 'active'
 *   - If override ratio exceeds threshold, invalidated
 *   - Patterns referencing deactivated packagings are invalidated
 */

import { supabase } from '@/lib/supabase/client'
import { classifyOrderProducts } from './packagingEngine'
import type { OrderProduct, ShippingUnitEntry, AdviceBox } from './packagingEngine'
import type { CostEntry } from './costProvider'
import crypto from 'crypto'

const PROMOTION_THRESHOLD = 3  // times_seen needed to promote to 'active'
const INVALIDATION_OVERRIDE_RATIO = 0.5  // override ratio that triggers invalidation
const INVALIDATION_MIN_OBSERVATIONS = 6  // minimum total observations before override ratio applies

// === Fingerprint building ===

/**
 * Build a packing fingerprint from shipping units (WITHOUT country code).
 * Format: "UnitName:qty|UnitName:qty" (alphabetically sorted by unit name)
 */
export function buildPackingFingerprint(shippingUnits: Map<string, ShippingUnitEntry>): string | null {
  if (shippingUnits.size === 0) return null
  return Array.from(shippingUnits.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => `${u.name}:${u.quantity}`)
    .join('|')
}

/**
 * Build a deterministic hash of the box pattern for fast comparison.
 * Sorts by packaging_id, then by unit assignments within each box.
 */
export function buildBoxPatternHash(boxes: BoxPatternEntry[]): string {
  const normalized = boxes
    .map(b => ({
      packaging_id: b.packaging_id,
      units: [...b.units].sort((a, b) => a.unit_id.localeCompare(b.unit_id))
    }))
    .sort((a, b) => a.packaging_id.localeCompare(b.packaging_id))

  const json = JSON.stringify(normalized)
  return crypto.createHash('sha256').update(json).digest('hex')
}

// === Types ===

export interface BoxPatternEntry {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  units: { unit_id: string; unit_name: string; qty: number }[]
}

export interface LearnedPattern {
  id: string
  fingerprint: string
  box_pattern: BoxPatternEntry[]
  status: 'learning' | 'active' | 'invalidated'
  times_seen: number
  times_overridden: number
}

// === Recording ===

/**
 * Record a packing pattern from a completed session.
 * Called from tryCompleteSession after all boxes are shipped.
 *
 * 1. Fetches session boxes + products
 * 2. Classifies products to get shipping units (excluding packaging/non-shippable)
 * 3. Builds fingerprint + box pattern
 * 4. Upserts into learned_packing_patterns
 */
export async function recordPackingPatternFromSession(sessionId: string): Promise<void> {
  // 1. Fetch session with boxes and their products
  const { data: session } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id, picklist_id, status')
    .eq('id', sessionId)
    .single()

  if (!session || session.status !== 'completed') return

  // 2. Fetch boxes for this session
  const { data: boxes } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .select('id, picqer_packaging_id, suggested_packaging_id, was_override')
    .eq('session_id', sessionId)
    .not('shipment_id', 'is', null)  // only shipped boxes

  if (!boxes || boxes.length === 0) return

  // 3. Fetch products for all boxes
  const boxIds = boxes.map(b => b.id)
  const { data: products } = await supabase
    .schema('batchmaker')
    .from('packing_session_products')
    .select('box_id, picqer_product_id, productcode, amount')
    .in('box_id', boxIds)

  if (!products || products.length === 0) return

  // 4. Build OrderProduct[] from session products (deduplicated across all boxes)
  const allProducts: OrderProduct[] = []
  const seen = new Map<number, number>()  // picqer_product_id -> index in allProducts
  for (const p of products) {
    const idx = seen.get(p.picqer_product_id)
    if (idx !== undefined) {
      allProducts[idx].quantity += p.amount
    } else {
      seen.set(p.picqer_product_id, allProducts.length)
      allProducts.push({
        picqer_product_id: p.picqer_product_id,
        productcode: p.productcode,
        quantity: p.amount,
      })
    }
  }

  // 5. Classify to get shipping units (same logic as engine)
  const { shippingUnits } = await classifyOrderProducts(allProducts)

  // 6. Build fingerprint
  const fingerprint = buildPackingFingerprint(shippingUnits)
  if (!fingerprint) return  // no classifiable products

  // 7. Map boxes to packagings (need packaging details)
  // Fetch packaging info for all boxes
  const packagingIds = [...new Set(boxes.map(b => b.picqer_packaging_id).filter(Boolean))]
  if (packagingIds.length === 0) return

  const { data: packagings } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, idpackaging, name')
    .in('idpackaging', packagingIds)

  if (!packagings || packagings.length === 0) return

  const pkgMap = new Map(packagings.map(p => [p.idpackaging, p]))

  // 8. Build box pattern: which packaging, which shipping units per box
  // For each box, get its products → classify → map to shipping units
  const boxPatterns: BoxPatternEntry[] = []

  for (const box of boxes) {
    const pkg = pkgMap.get(box.picqer_packaging_id)
    if (!pkg) continue

    const boxProducts = products.filter(p => p.box_id === box.id)
    const boxOrderProducts: OrderProduct[] = boxProducts.map(p => ({
      picqer_product_id: p.picqer_product_id,
      productcode: p.productcode,
      quantity: p.amount,
    }))

    const { shippingUnits: boxUnits } = await classifyOrderProducts(boxOrderProducts)

    const units = Array.from(boxUnits.values()).map(u => ({
      unit_id: u.id,
      unit_name: u.name,
      qty: u.quantity,
    }))

    boxPatterns.push({
      packaging_id: pkg.id,
      packaging_name: pkg.name,
      idpackaging: pkg.idpackaging,
      units,
    })
  }

  if (boxPatterns.length === 0) return

  // 9. Check if any box was an override
  const wasOverride = boxes.some(b => b.was_override === true)

  // 10. Build hash
  const hash = buildBoxPatternHash(boxPatterns)

  // 11. Upsert pattern
  await upsertPattern(fingerprint, boxPatterns, hash, sessionId, wasOverride)
}

/**
 * Upsert a packing pattern observation.
 */
async function upsertPattern(
  fingerprint: string,
  boxPattern: BoxPatternEntry[],
  hash: string,
  sessionId: string,
  wasOverride: boolean
): Promise<void> {
  // Check if this exact pattern exists
  const { data: existing } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('id, times_seen, times_overridden, status')
    .eq('fingerprint', fingerprint)
    .eq('box_pattern_hash', hash)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'invalidated') return  // don't resurrect invalidated patterns

    const updates: Record<string, unknown> = {
      last_session_id: sessionId,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (wasOverride) {
      updates.times_overridden = existing.times_overridden + 1

      // Check if override ratio exceeds threshold
      const totalObs = existing.times_seen + existing.times_overridden + 1
      const overrideRatio = (existing.times_overridden + 1) / totalObs
      if (totalObs >= INVALIDATION_MIN_OBSERVATIONS && overrideRatio > INVALIDATION_OVERRIDE_RATIO) {
        updates.status = 'invalidated'
        updates.invalidated_at = new Date().toISOString()
        updates.invalidation_reason = `Override ratio ${(overrideRatio * 100).toFixed(0)}% exceeds threshold`
        console.log(`[patternLearner] Invalidated pattern ${existing.id}: override ratio ${(overrideRatio * 100).toFixed(0)}%`)
      }
    } else {
      updates.times_seen = existing.times_seen + 1

      // Check if pattern should be promoted
      if (existing.status === 'learning' && existing.times_seen + 1 >= PROMOTION_THRESHOLD) {
        updates.status = 'active'
        updates.promoted_at = new Date().toISOString()
        console.log(`[patternLearner] Promoted pattern ${existing.id} to active (${existing.times_seen + 1} observations)`)
      }
    }

    await supabase
      .schema('batchmaker')
      .from('learned_packing_patterns')
      .update(updates)
      .eq('id', existing.id)
  } else {
    // New pattern — first observation
    await supabase
      .schema('batchmaker')
      .from('learned_packing_patterns')
      .insert({
        fingerprint,
        box_pattern: boxPattern,
        box_pattern_hash: hash,
        times_seen: 1,
        times_overridden: 0,
        status: 'learning',
        last_session_id: sessionId,
      })

    console.log(`[patternLearner] New pattern recorded for fingerprint: ${fingerprint}`)
  }
}

// === Lookup ===

/**
 * Find an active learned pattern for a given fingerprint.
 * Returns the pattern with the highest times_seen.
 */
export async function findLearnedPattern(fingerprint: string): Promise<LearnedPattern | null> {
  const { data } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('id, fingerprint, box_pattern, status, times_seen, times_overridden')
    .eq('fingerprint', fingerprint)
    .eq('status', 'active')
    .order('times_seen', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    fingerprint: data.fingerprint,
    box_pattern: data.box_pattern as BoxPatternEntry[],
    status: data.status,
    times_seen: data.times_seen,
    times_overridden: data.times_overridden,
  }
}

/**
 * Validate that all packagings in a learned pattern are still active.
 * Returns false if any packaging has been deactivated.
 */
export async function validatePatternPackagings(pattern: LearnedPattern): Promise<boolean> {
  const packagingIds = pattern.box_pattern.map(b => b.packaging_id)

  const { data } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id')
    .in('id', packagingIds)
    .eq('active', true)

  return data !== null && data.length === packagingIds.length
}

/**
 * Convert a learned pattern into AdviceBox[] for the engine.
 * Enriches with cost data if available.
 */
export function learnedPatternToAdviceBoxes(
  pattern: LearnedPattern,
  _costMap: Map<string, CostEntry[]> | null
): AdviceBox[] {
  return pattern.box_pattern.map(entry => {
    const box: AdviceBox = {
      packaging_id: entry.packaging_id,
      packaging_name: entry.packaging_name,
      idpackaging: entry.idpackaging,
      products: entry.units.map(u => ({
        productcode: u.unit_name,  // Use unit name as identifier (abstract)
        shipping_unit_name: u.unit_name,
        quantity: u.qty,
      })),
    }

    // Cost enrichment requires facturatie_box_sku from packagings table.
    // To keep this function synchronous, costs are enriched downstream by the caller
    // when they have the packaging details + country-specific cost map.
    return box
  })
}

// === Invalidation ===

/**
 * Invalidate all active/learning patterns that reference a specific packaging.
 * Called when a packaging is deactivated or deleted.
 */
export async function invalidatePatternsForPackaging(
  packagingId: string,
  reason: string
): Promise<number> {
  // Find patterns containing this packaging_id in their box_pattern
  const { data: patterns } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('id, box_pattern')
    .in('status', ['learning', 'active'])

  if (!patterns || patterns.length === 0) return 0

  const toInvalidate = patterns.filter(p => {
    const boxPattern = p.box_pattern as BoxPatternEntry[]
    return boxPattern.some(b => b.packaging_id === packagingId)
  })

  if (toInvalidate.length === 0) return 0

  const ids = toInvalidate.map(p => p.id)
  const now = new Date().toISOString()

  await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .update({
      status: 'invalidated',
      invalidated_at: now,
      invalidation_reason: reason,
      updated_at: now,
    })
    .in('id', ids)

  console.log(`[patternLearner] Invalidated ${ids.length} patterns for packaging ${packagingId}: ${reason}`)
  return ids.length
}
