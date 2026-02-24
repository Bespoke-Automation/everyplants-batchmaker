/**
 * Cost Provider — Cross-database cost data access layer
 *
 * Fetches packaging + transport costs from the facturatie Supabase database.
 * Provides a cached lookup of CostEntry objects per country, keyed by packaging SKU.
 *
 * The facturatie tables (packaging_costs, shipping_rates) are in the `public` schema,
 * so NO .schema() call is needed — the facturatie client uses public by default.
 *
 * Cache strategy: All cost data (all countries, all boxes) is fetched in a single query
 * and cached in-memory with a 15-minute TTL. Subsequent calls within TTL return cached data.
 *
 * Graceful degradation: If the facturatie database is unreachable or env vars are missing,
 * getAllCostsForCountry() returns null (never throws). This signals "cost data unavailable"
 * to callers, allowing the engine to fall back to specificity-based ranking.
 */

import { getFacturatieSupabase } from '@/lib/supabase/facturatieClient'
import type { CostEntry } from '@/types/verpakking'

export type { CostEntry }

// ── Cache ────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

/** Nested map: country_code -> sku -> CostEntry */
let costCache: Map<string, Map<string, CostEntry>> | null = null
let cacheTimestamp = 0

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get all cost entries for a specific country.
 *
 * @returns Map<sku, CostEntry> if data is available, empty Map if country has no routes,
 *          or null if the facturatie database is unreachable.
 */
export async function getAllCostsForCountry(
  countryCode: string
): Promise<Map<string, CostEntry> | null> {
  const cache = await ensureCache()
  if (cache === null) return null

  return cache.get(countryCode.toUpperCase()) ?? new Map()
}

/**
 * Clear the cost cache so the next call fetches fresh data.
 */
export function invalidateCostCache(): void {
  costCache = null
  cacheTimestamp = 0
}

// ── Internal ─────────────────────────────────────────────────────────────────

/**
 * Ensure the cache is populated and fresh. Returns null if facturatie is unreachable.
 */
async function ensureCache(): Promise<Map<string, Map<string, CostEntry>> | null> {
  try {
    if (costCache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
      return costCache
    }

    const freshData = await fetchAllCosts()
    if (freshData === null) return null

    costCache = freshData
    cacheTimestamp = Date.now()
    return costCache
  } catch (error) {
    console.error('[costProvider] Failed to load cost data:', error)
    return null
  }
}

/**
 * Single query to fetch ALL cost data (all countries, all boxes) from facturatie.
 * Only returns preferred + available routes.
 */
async function fetchAllCosts(): Promise<Map<string, Map<string, CostEntry>> | null> {
  const facturatieSupabase = getFacturatieSupabase()

  const { data, error } = await facturatieSupabase
    .from('shipping_rates')
    .select(
      'box_sku, country_code, carrier, shipping_cost, packaging_costs!inner(sku, name, total_purchase_price)'
    )
    .eq('is_preferred', true)
    .eq('is_available', true)

  if (error) {
    console.error('[costProvider] Supabase query error:', error.message)
    return null
  }

  if (!data) return new Map()

  // Build nested map: country_code -> sku -> CostEntry
  const result = new Map<string, Map<string, CostEntry>>()

  for (const row of data) {
    // packaging_costs is joined via !inner, so it's always present
    // Supabase returns the FK join as an object (single row) or array
    const pc = Array.isArray(row.packaging_costs)
      ? row.packaging_costs[0]
      : row.packaging_costs

    if (!pc) continue

    const country = row.country_code.toUpperCase()
    const boxCost = parseFloat(String(pc.total_purchase_price))
    const transportCost = parseFloat(String(row.shipping_cost))

    const entry: CostEntry = {
      boxSku: pc.sku,
      boxName: pc.name,
      boxCost,
      transportCost,
      carrier: row.carrier,
      totalCost: boxCost + transportCost,
    }

    if (!result.has(country)) {
      result.set(country, new Map())
    }
    result.get(country)!.set(entry.boxSku, entry)
  }

  return result
}
