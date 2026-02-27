/**
 * Cost Provider — Cross-database cost data access layer (v2)
 *
 * Fetches packaging + transport costs from the facturatie Supabase database.
 * Reads from the `published_box_costs` contract table, keyed by `box_sku` (facturatie_box_sku).
 *
 * Cache structure: country_code -> box_sku -> CostEntry[] (array for weight brackets)
 * PostNL boxes have multiple weight brackets per SKU/country combo.
 * DPD/pallet entries have weight_bracket = NULL (always match any weight).
 *
 * Cache strategy: All cost data (all countries, all boxes) is fetched in a single query
 * and cached in-memory with a 15-minute TTL. Subsequent calls within TTL return cached data.
 *
 * Graceful degradation: If the facturatie database is unreachable or env vars are missing,
 * getAllCostsForCountry() returns null (never throws). This signals "cost data unavailable"
 * to callers, allowing the engine to fall back to specificity-based ranking.
 *
 * SKU mapping validation: After each cache refresh, checks which active packagings have
 * facturatie_box_sku values that don't appear in published_box_costs (logged as warnings).
 */

import { getFacturatieSupabase } from '@/lib/supabase/facturatieClient'
import { supabase } from '@/lib/supabase/client'
import type { CostEntry } from '@/types/verpakking'

export type { CostEntry }

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

/** Nested map: country_code -> box_sku -> CostEntry[] */
let costCache: Map<string, Map<string, CostEntry[]>> | null = null
let cacheTimestamp = 0
let validationDone = false

// ── Weight bracket parsing ───────────────────────────────────────────────────

/** Parse weight bracket string to max weight in grams. Returns Infinity for NULL brackets. */
function parseBracketMaxGrams(bracket: string | null): number {
  if (!bracket) return Infinity
  // Format: '0-5kg', '5-10kg', '10-20kg', '20-30kg'
  const match = bracket.match(/(\d+)-(\d+)kg/)
  if (!match) return Infinity
  return parseInt(match[2], 10) * 1000
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all cost entries for a specific country.
 *
 * @returns Map<box_sku, CostEntry[]> if data is available, empty Map if country has no routes,
 *          or null if the facturatie database is unreachable.
 */
export async function getAllCostsForCountry(
  countryCode: string
): Promise<Map<string, CostEntry[]> | null> {
  const cache = await ensureCache()
  if (cache === null) return null

  return cache.get(countryCode.toUpperCase()) ?? new Map()
}

/**
 * Select the correct cost entry for a given weight in grams.
 *
 * - NULL weight_bracket entries (DPD/pallet) always match any weight
 * - For PostNL (has brackets): select the bracket where weightGrams <= bracket max
 * - If weight exceeds all brackets (>30kg), return null (no PostNL option available)
 * - If no bracket match but NULL entries exist, return the NULL entry
 */
export function selectCostForWeight(
  entries: CostEntry[],
  weightGrams: number
): CostEntry | null {
  if (!entries || entries.length === 0) return null

  // Separate NULL bracket entries from weight-bracketed entries
  const nullBracketEntries = entries.filter(e => e.weightBracket === null)
  const bracketedEntries = entries.filter(e => e.weightBracket !== null)

  if (bracketedEntries.length === 0) {
    // Only NULL bracket entries (DPD/pallet) — return the first one
    return nullBracketEntries[0] ?? null
  }

  // Try to find a matching bracket
  // Sort by max weight ascending so we pick the smallest bracket that fits
  const sorted = bracketedEntries.sort((a, b) => {
    return parseBracketMaxGrams(a.weightBracket) - parseBracketMaxGrams(b.weightBracket)
  })

  for (const entry of sorted) {
    const maxGrams = parseBracketMaxGrams(entry.weightBracket)
    if (weightGrams <= maxGrams) {
      return entry
    }
  }

  // Weight exceeds all brackets — no bracketed option available
  // Fall back to NULL bracket if available
  if (nullBracketEntries.length > 0) {
    return nullBracketEntries[0]
  }

  return null
}

/**
 * Clear the cost cache so the next call fetches fresh data.
 */
export function invalidateCostCache(): void {
  costCache = null
  cacheTimestamp = 0
  validationDone = false
}

// ── Internal ─────────────────────────────────────────────────────────────────

/**
 * Ensure the cache is populated and fresh. Returns null if facturatie is unreachable.
 */
async function ensureCache(): Promise<Map<string, Map<string, CostEntry[]>> | null> {
  try {
    if (costCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      return costCache
    }

    const freshData = await fetchAllCosts()
    if (freshData === null) return null

    costCache = freshData
    cacheTimestamp = Date.now()

    // Validate SKU mappings once per cache refresh
    if (!validationDone) {
      await validateSkuMappings(freshData)
      validationDone = true
    }

    return costCache
  } catch (error) {
    console.error('[costProvider] Failed to load cost data:', error)
    return null
  }
}

/**
 * Single query to fetch ALL cost data (all countries, all boxes) from facturatie.
 * Reads from the published_box_costs contract table.
 */
async function fetchAllCosts(): Promise<Map<string, Map<string, CostEntry[]>> | null> {
  let facturatieSupabase
  try {
    facturatieSupabase = getFacturatieSupabase()
  } catch (error) {
    console.error('[costProvider] Facturatie client unavailable:', error)
    return null
  }

  const { data, error } = await facturatieSupabase
    .from('published_box_costs')
    .select('box_sku, box_name, country_code, carrier_code, tariff_class, weight_bracket, is_pallet, vehicle_type, box_material_cost, box_pick_cost, box_pack_cost, transport_purchase_cost, total_cost, calculated_at')
    .eq('price_group', 'ep')

  if (error) {
    console.error('[costProvider] Supabase query error:', error.message)
    return null
  }

  if (!data) return new Map()

  // Build nested map: country_code -> box_sku -> CostEntry[]
  const result = new Map<string, Map<string, CostEntry[]>>()

  for (const row of data) {
    const country = (row.country_code as string).toUpperCase()
    const boxMaterialCost = parseFloat(String(row.box_material_cost))
    const boxPickCost = parseFloat(String(row.box_pick_cost))
    const boxPackCost = parseFloat(String(row.box_pack_cost))
    const transportCost = parseFloat(String(row.transport_purchase_cost))
    const totalCost = parseFloat(String(row.total_cost))

    const entry: CostEntry = {
      boxSku: row.box_sku,
      boxName: row.box_name,
      countryCode: country,
      carrier: row.carrier_code,
      tariffClass: row.tariff_class,
      weightBracket: row.weight_bracket ?? null,
      isPallet: row.is_pallet ?? false,
      vehicleType: row.vehicle_type ?? null,
      boxMaterialCost,
      boxPickCost,
      boxPackCost,
      transportCost,
      totalCost,
      calculatedAt: row.calculated_at,
      // v1 compatibility alias
      boxCost: boxMaterialCost,
    }

    if (!result.has(country)) {
      result.set(country, new Map())
    }
    const countryMap = result.get(country)!
    if (!countryMap.has(entry.boxSku)) {
      countryMap.set(entry.boxSku, [])
    }
    countryMap.get(entry.boxSku)!.push(entry)
  }

  console.log(`[costProvider] Loaded ${data.length} cost entries for ${result.size} countries`)
  return result
}

/**
 * Validate that active packagings with facturatie_box_sku have matching cost data.
 * Logs warnings for SKUs without cost data and info for packagings without SKU mapping.
 * Only runs once per cache refresh cycle.
 */
async function validateSkuMappings(
  costData: Map<string, Map<string, CostEntry[]>>
): Promise<void> {
  try {
    // Fetch all active packagings used in auto advice
    const { data: packagings, error } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('name, barcode, facturatie_box_sku, use_in_auto_advice')
      .eq('active', true)
      .eq('use_in_auto_advice', true)

    if (error || !packagings) {
      console.warn('[costProvider] Could not fetch packagings for SKU validation:', error?.message)
      return
    }

    // Collect all known SKUs across all countries
    const allKnownSkus = new Set<string>()
    for (const countryMap of costData.values()) {
      for (const sku of countryMap.keys()) {
        allKnownSkus.add(sku)
      }
    }

    for (const pkg of packagings) {
      if (pkg.facturatie_box_sku) {
        if (!allKnownSkus.has(pkg.facturatie_box_sku)) {
          console.warn(
            `[costProvider] WARNING: packaging "${pkg.name}" (facturatie_box_sku=${pkg.facturatie_box_sku}) has no cost data in published_box_costs`
          )
        }
      } else {
        console.log(
          `[costProvider] INFO: packaging "${pkg.name}" has no facturatie_box_sku mapping - will use specificity ranking`
        )
      }
    }
  } catch (err) {
    // Non-fatal: validation is informational only
    console.warn('[costProvider] SKU validation failed (non-fatal):', err)
  }
}
