# Phase 1: Cost Data Layer - Research

**Researched:** 2026-02-24
**Domain:** Cross-database cost data access, in-memory caching, engine parameter threading
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundation that all subsequent phases depend on: the ability to look up total packaging costs (box material + transport) for any box/country combination, thread the destination country through the engine pipeline, and degrade gracefully when the facturatie database is unreachable.

The implementation is straightforward because all infrastructure already exists. The facturatie Supabase client (`src/lib/supabase/facturatieClient.ts`) is a working singleton. The existing `syncPackagingCosts.ts` already demonstrates the cross-database pattern using `barcode` (batchmaker) = `sku` (facturatie) as join key. The `VerpakkingsClient` already fetches the full Picqer order (including `deliverycountry`) when a picklist loads. The only new code is a `costProvider.ts` module (~120 lines) and modifications to thread `countryCode` through `calculateAdvice()`, the API route, and the fingerprint deduplication.

The critical risks are all in data correctness: silently defaulting to NL when no country is provided, treating unavailable shipping routes as free, and serving cached advice from one country for a different country via the fingerprint deduplication. All three must be addressed in this phase.

**Primary recommendation:** Build `costProvider.ts` as a single module owning all facturatie cost queries with in-memory caching. Thread `countryCode` as a required parameter through the full call chain. Update `buildFingerprint()` to include country. Add `cost_data_available` flag to the result type for graceful degradation.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | 2.90.1 | Database access for facturatie Supabase | Already used; `facturatieClient.ts` exists as singleton |
| `next` | 16.1.1 | API routes serve engine calculate endpoint | Already used; no changes to framework |
| TypeScript | 5.8.2 | Type safety for new `CostEntry` interface | Already used; strict types throughout |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Built-in `Map` | N/A | In-memory cache for cost data (15-min TTL) | Always -- zero dependency solution for ~300 rows |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Module-level `Map` cache | Redis / Upstash | Overkill for ~300 rows that change weekly; adds infra dependency |
| Direct facturatie query | Replicate to batchmaker Supabase | Two sources of truth; sync complexity; transport costs are per-country and don't fit the `packagings` table structure |
| Full pre-fetch (all countries) | Per-country lazy fetch | Full pre-fetch is better: ~300 rows total, one query, shared across requests |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended File Structure

```
src/lib/engine/
  costProvider.ts       # NEW: cross-database cost lookup with in-memory cache
  packagingEngine.ts    # MODIFIED: countryCode param, fingerprint update, cost_data_available flag
```

### Pattern 1: Module-Level Singleton Cache with TTL

**What:** A module-scope `Map` holding all cost data, with a timestamp and 15-minute TTL. First call fetches all data from facturatie; subsequent calls within TTL return cached data.
**When to use:** Small dataset (~300 rows) that changes rarely (weekly at most), read frequently (every engine call), and must be fast (real-time packing sessions).
**Example:**
```typescript
// Source: existing pattern in src/lib/supabase/facturatieClient.ts (singleton) and
// src/lib/picqer/client.ts (30s order cache)

// Module-level state
let costCache: Map<string, Map<string, CostEntry>> | null = null  // country -> sku -> CostEntry
let cacheTimestamp = 0
const CACHE_TTL_MS = 15 * 60 * 1000  // 15 minutes

async function ensureCache(): Promise<Map<string, Map<string, CostEntry>>> {
  if (costCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return costCache
  }
  costCache = await fetchAllCosts()
  cacheTimestamp = Date.now()
  return costCache
}

export function invalidateCostCache(): void {
  costCache = null
  cacheTimestamp = 0
}
```

### Pattern 2: Required Parameter -- Never Default

**What:** `countryCode` is a required (non-optional) string parameter on `calculateAdvice()` and the API route. No fallback to 'NL'.
**When to use:** Always. The caller (VerpakkingsClient) already has the data from `order.deliverycountry`.
**Example:**
```typescript
// In packagingEngine.ts
export async function calculateAdvice(
  orderId: number,
  picklistId?: number,
  products?: OrderProduct[],
  shippingProviderProfileId?: number,
  countryCode?: string  // NEW: required in practice, optional for backward compat in Phase 1
): Promise<PackagingAdviceResult>

// In API route -- validate and reject
if (!countryCode || typeof countryCode !== 'string') {
  return NextResponse.json(
    { error: 'countryCode is required' },
    { status: 400 }
  )
}
```

**Important timing note:** In `VerpakkingsClient`, the engine call fires in a `useEffect` when `picklist.products` are available (line 286-327). The order (with `deliverycountry`) is fetched separately (line 254-276). The engine call must wait for BOTH picklist products AND order data to be available before firing.

### Pattern 3: Graceful Degradation with Flag

**What:** When the facturatie database is unreachable, the cost provider returns `null` and the engine continues with its existing specificity-based ranking. A `cost_data_available: boolean` flag is set on the result.
**When to use:** Any cross-database dependency where the secondary database is not critical-path.
**Example:**
```typescript
// In costProvider.ts
export async function getAllCostsForCountry(
  countryCode: string
): Promise<Map<string, CostEntry> | null> {
  try {
    const cache = await ensureCache()
    return cache.get(countryCode) ?? new Map()
  } catch (err) {
    console.error('[costProvider] Facturatie DB unreachable, falling back:', err)
    return null  // null = unavailable, empty Map = no routes for this country
  }
}

// In packagingEngine.ts calculateAdvice()
const costs = await getAllCostsForCountry(countryCode)
const costDataAvailable = costs !== null
// If costs is null, skip enrichment, use existing ranking
```

### Anti-Patterns to Avoid

- **Silent NL default:** Never `const country = countryCode || 'NL'`. If country is missing, throw/reject explicitly. The `transform.ts` already does `order.deliverycountry || 'NL'` -- this is fine for display but NOT for cost lookups.
- **Per-box cost fetch:** Don't call `getShippingCost(sku, country)` inside a loop. Bulk-fetch all costs for the country once, then look up per box.
- **Replicate transport costs to batchmaker:** Transport costs are per-country; they don't fit in the `packagings` table which has one row per box. Keep them in facturatie.
- **Treat missing rate as zero cost:** A missing `shipping_rates` row means "route unavailable", NOT "free shipping". Return `null` for the cost entry, not `0`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Supabase client for facturatie | New client setup | `getFacturatieSupabase()` from `facturatieClient.ts` | Already exists, singleton pattern, has `cache: 'no-store'` override |
| In-memory TTL cache | Custom cache class with timers | Module-level `Map` + timestamp check | Dead simple for 300 rows; no npm package needed |
| Country code validation | Custom regex | Array of known codes `['NL','BE','DE','FR','AT','LU','SE','IT','ES']` | Fixed set from FACTURATIE_SPEC seed data |
| Barcode-to-SKU mapping | New mapping table | `packagings.barcode` = `packaging_costs.sku` | Already validated by `syncPackagingCosts.ts` |

**Key insight:** The entire cost provider is ~120 lines. The complexity is not in the code but in getting the data flow correct (country threading, fingerprint, degradation). Don't over-engineer the module itself.

## Common Pitfalls

### Pitfall 1: Engine Call Fires Before Order Data Is Available

**What goes wrong:** In `VerpakkingsClient`, the engine `useEffect` (line 286) fires when `picklist.products` are available. The order (with `deliverycountry`) is fetched in a separate `useEffect` (line 254). If the engine fires before the order loads, `countryCode` will be undefined.

**Why it happens:** React effects run independently. The picklist products may load before the order fetch completes.

**How to avoid:** Add `order?.deliverycountry` to the engine call's dependency guard:
```typescript
if (engineCalledRef.current) return
if (!picklist?.products || picklist.products.length === 0) return
if (!picklist.idorder) return
if (!order?.deliverycountry) return  // NEW: wait for order data
```

**Warning signs:** Engine requests arriving at the API without `countryCode`, or with `undefined`.

### Pitfall 2: Fingerprint Deduplication Returns Wrong Country's Advice

**What goes wrong:** The current `buildFingerprint()` (line 885-890) builds a fingerprint from shipping unit names and quantities only. Two orders with identical products but different countries (NL vs DE) get the same fingerprint. The deduplication check (line 913-944) returns cached advice calculated for a different country.

**Why it happens:** The fingerprint was designed before country mattered for ranking.

**How to avoid:** Include `countryCode` in the fingerprint:
```typescript
function buildFingerprint(shippingUnits: Map<string, ShippingUnitEntry>, countryCode: string): string {
  const units = Array.from(shippingUnits.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(u => `${u.name}:${u.quantity}`)
    .join('|')
  return `${countryCode}|${units}`
}
```

**Warning signs:** International orders showing identical box recommendations as NL orders for the same products.

### Pitfall 3: Unavailable Routes Treated as Free Shipping

**What goes wrong:** The FACTURATIE_SPEC shows Fold box 180 has no route to France (no PostNL row for FR, DPD rows with `shipping_cost = 0`). If the query doesn't filter `is_available = true`, the engine might rank these as the cheapest option.

**Why it happens:** The seed data uses two patterns: (1) no row at all (PostNL + Fold box 180 + FR), (2) rows with `shipping_cost = 0` and `is_preferred = false` (DPD + Fold box 180 + all countries). The DPD rows for Fold box 180 don't have `is_available = false` explicitly.

**How to avoid:**
1. The query must filter `is_preferred = true` AND `is_available = true` (or default `true`)
2. If no `shipping_rates` row exists for a box/country after filtering, treat as "route unavailable"
3. Cost provider returns `null` for that box/country, not `{ totalCost: 0 }`

**Warning signs:** Boxes with `shipping_cost = 0` appearing in cost results; Fold box 180 recommended for French orders.

### Pitfall 4: Cross-Database Failure Crashes Engine Mid-Packing

**What goes wrong:** If `FACTURATIE_SUPABASE_URL` is not set, or the facturatie DB is temporarily unreachable, `getFacturatieSupabase()` throws. If the cost provider doesn't catch this, `calculateAdvice()` throws, and the packing session shows an error.

**Why it happens:** `getFacturatieSupabase()` throws synchronously if env vars are missing (line 9-10 of `facturatieClient.ts`). Network errors during the query are async but equally fatal if uncaught.

**How to avoid:**
1. Wrap the entire cache fetch in try/catch
2. Return `null` (not empty `Map`) to signal "facturatie unavailable"
3. In `calculateAdvice()`, check for `null` and skip cost enrichment
4. Set `cost_data_available: false` on the result

**Warning signs:** 500 errors on `/api/verpakking/engine/calculate`; `getFacturatieSupabase` errors in server logs.

### Pitfall 5: FACTURATIE_SPEC Tables Don't Exist Yet

**What goes wrong:** The FACTURATIE_SPEC.md describes `packaging_costs` and `shipping_rates` tables that need to be CREATED in the facturatie Supabase. The existing `syncPackagingCosts.ts` reads from `boxes` table, which is a different (existing) table. Building the cost provider against a schema that doesn't exist yet will fail.

**Why it happens:** FACTURATIE_SPEC.md is a PLANNING document, not a reflection of current state.

**How to avoid:**
1. Before building the cost provider, the `packaging_costs` and `shipping_rates` tables must be created in facturatie Supabase
2. Seed data from FACTURATIE_SPEC.md must be inserted
3. The cost provider queries these new tables, NOT the existing `boxes` table
4. This is a manual step by Kenny (noted as dependency in REQUIREMENTS.md)

**Warning signs:** Query errors referencing non-existent tables; empty results from facturatie.

## Code Examples

### Example 1: The Core Facturatie Query

The cost provider executes ONE query to load all cost data:

```typescript
// Source: FACTURATIE_SPEC.md query specification + existing facturatieClient.ts pattern
import { getFacturatieSupabase } from '@/lib/supabase/facturatieClient'

interface RawCostRow {
  sku: string
  name: string
  total_purchase_price: number
  country_code: string
  carrier: string
  shipping_cost: number
}

async function fetchAllCosts(): Promise<Map<string, Map<string, CostEntry>>> {
  const facturatie = getFacturatieSupabase()

  // Single query: packaging_costs JOIN shipping_rates WHERE preferred AND available
  const { data, error } = await facturatie
    .from('shipping_rates')
    .select(`
      box_sku,
      country_code,
      carrier,
      shipping_cost,
      packaging_costs!inner (
        sku,
        name,
        total_purchase_price
      )
    `)
    .eq('is_preferred', true)
    .eq('is_available', true)

  if (error) throw new Error(`Failed to fetch cost data: ${error.message}`)

  // Build nested map: country -> sku -> CostEntry
  const result = new Map<string, Map<string, CostEntry>>()

  for (const row of (data ?? [])) {
    const pc = row.packaging_costs as unknown as { sku: string; name: string; total_purchase_price: number }
    const entry: CostEntry = {
      boxSku: pc.sku,
      boxName: pc.name,
      boxCost: Number(pc.total_purchase_price),
      transportCost: Number(row.shipping_cost),
      carrier: row.carrier,
      totalCost: Number(pc.total_purchase_price) + Number(row.shipping_cost),
    }

    if (!result.has(row.country_code)) {
      result.set(row.country_code, new Map())
    }
    result.get(row.country_code)!.set(pc.sku, entry)
  }

  return result
}
```

**Note on Supabase join syntax:** The facturatie Supabase uses the `public` schema (no `.schema()` call needed, unlike batchmaker which requires `.schema('batchmaker')`). The join uses the FK relationship `shipping_rates.box_sku -> packaging_costs.sku`. The `!inner` modifier ensures only rows with matching `packaging_costs` are returned.

**Alternative query approach (if FK join doesn't work):** Use a raw SQL query via `facturatie.rpc()` or two separate queries joined in TypeScript. The FK relationship must exist for Supabase joins to work.

### Example 2: Country Threading in calculateAdvice

```typescript
// Source: existing calculateAdvice signature at line 894 of packagingEngine.ts

export async function calculateAdvice(
  orderId: number,
  picklistId?: number,
  products?: OrderProduct[],
  shippingProviderProfileId?: number,
  countryCode?: string  // NEW parameter
): Promise<PackagingAdviceResult> {
  // ...existing validation...

  // Step 1b: Build fingerprint (MODIFIED to include country)
  const effectiveCountry = countryCode ?? 'UNKNOWN'
  const fingerprint = shippingUnits.size > 0
    ? buildFingerprint(shippingUnits, effectiveCountry)
    : null

  // Step 1c: Deduplication check (unchanged -- fingerprint now includes country)

  // ...existing match/rank/solve steps...

  // Insert: include country_code in advice row
  const adviceRow = {
    // ...existing fields...
    country_code: countryCode ?? null,  // NEW column
    cost_data_available: true,          // NEW column (set to false on degradation)
  }
}
```

### Example 3: Graceful Degradation Flow

```typescript
// In calculateAdvice, after matchCompartments:
import { getAllCostsForCountry } from './costProvider'

// Attempt cost enrichment
let costDataAvailable = true
if (countryCode) {
  const costs = await getAllCostsForCountry(countryCode)
  if (costs !== null) {
    // Enrich matches with cost data (Phase 2 will use this for ranking)
    // For Phase 1: just store the availability flag
    costDataAvailable = true
  } else {
    costDataAvailable = false
    console.warn(`[packagingEngine] Cost data unavailable, falling back to specificity ranking`)
  }
}

// Pass to result
const adviceRow = {
  // ...
  cost_data_available: costDataAvailable,
}
```

### Example 4: VerpakkingsClient Engine Call Timing Fix

```typescript
// Source: VerpakkingsClient.tsx lines 286-327

// Call packaging engine when BOTH picklist products AND order data are available
useEffect(() => {
  if (engineCalledRef.current) return
  if (!picklist?.products || picklist.products.length === 0) return
  if (!picklist.idorder) return
  if (!order?.deliverycountry) return  // NEW: wait for order to load

  engineCalledRef.current = true
  setEngineLoading(true)

  const products = picklist.products.map((pp: PicqerPicklistProduct) => ({
    picqer_product_id: pp.idproduct,
    productcode: pp.productcode,
    quantity: pp.amount,
  }))

  fetch('/api/verpakking/engine/calculate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: picklist.idorder,
      picklistId: picklist.idpicklist,
      products,
      shippingProviderProfileId: picklist.idshippingprovider_profile ?? undefined,
      countryCode: order.deliverycountry,  // NEW: pass country
    }),
  })
  // ...rest unchanged
}, [picklist, order])  // NEW: add order to deps
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `material_cost` synced from facturatie `boxes` table | Will read `packaging_costs` + `shipping_rates` from facturatie | Phase 1 | Cost-per-country awareness added |
| `rankPackagings()` uses specificity -> volume -> cost | Phase 2 will change to cost -> specificity -> volume | Future (Phase 2) | Phase 1 only establishes data layer |
| No country awareness in engine | `countryCode` threaded through full call chain | Phase 1 | Foundation for country-specific advice |
| Fingerprint ignores country | Fingerprint includes country | Phase 1 | Correct deduplication across countries |

**Deprecated/outdated:**
- The existing `syncPackagingCosts.ts` reads from `facturatie.boxes` table -- this is a separate mechanism that syncs `material_cost` (box cost only) into the local `packagings` table. It will continue to work independently. The new cost provider reads from the new `packaging_costs` + `shipping_rates` tables for the full cost picture (box + transport per country).

## Open Questions

1. **Are the `packaging_costs` and `shipping_rates` tables already created in facturatie Supabase?**
   - What we know: FACTURATIE_SPEC.md has the complete CREATE TABLE statements and seed data. REQUIREMENTS.md lists this as a dependency owned by Kenny (status: "Seed data klaar in FACTURATIE_SPEC.md").
   - What's unclear: Whether Kenny has already executed these statements against the live facturatie Supabase.
   - Recommendation: Verify before implementation. The cost provider cannot be tested without these tables. If not created yet, this is a blocking prerequisite.

2. **Does the `packaging_costs` table have a foreign key relationship that Supabase recognizes for joins?**
   - What we know: FACTURATIE_SPEC defines `shipping_rates.box_sku REFERENCES packaging_costs(sku)`. Supabase should recognize this FK for join queries.
   - What's unclear: Whether the FK was actually created (constraints might be omitted in practice).
   - Recommendation: If FK doesn't exist, use two separate queries or raw SQL. Not a blocker -- just a query syntax difference.

3. **How does `order.deliverycountry` behave for edge cases?**
   - What we know: `transform.ts` line 125 uses `order.deliverycountry || 'NL'` as a fallback. Picqer docs say it's a string field on the order.
   - What's unclear: Whether it's always a 2-letter ISO code (NL, DE) or could be a full name ("Netherlands", "Duitsland"). Whether it can be null/empty on real orders.
   - Recommendation: Normalize to uppercase 2-letter code before passing to engine. Log unexpected values. Add a mapping for any non-ISO values found in production.

4. **What schema does the facturatie Supabase use?**
   - What we know: FACTURATIE_SPEC says "All tables in a `shipping` schema (or `public` if you don't want a schema)." The existing `syncPackagingCosts.ts` calls `facturatieSupabase.from('boxes')` without `.schema()`, implying it's using `public`.
   - What's unclear: Whether `packaging_costs` and `shipping_rates` will also be in `public` or in a `shipping` schema.
   - Recommendation: Check the actual facturatie setup. If a `shipping` schema is used, the cost provider needs `.schema('shipping')` calls.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DATA-01 | Transport tarieven ophalen uit facturatie Supabase | `costProvider.ts` reads `packaging_costs` JOIN `shipping_rates` via `getFacturatieSupabase()`. In-memory cache with 15-min TTL. Query pattern documented in Code Example 1. Join key `barcode = sku` validated by existing `syncPackagingCosts.ts`. |
| DATA-02 | Carrier routing tabel -- engine uses `is_preferred = true` | Query filters `is_preferred = true AND is_available = true`. Per box/country, exactly one preferred carrier rate is returned. Unavailable routes (no matching row) return `null`, not zero. Pattern documented in Code Example 1 and Pitfall 3. |
| DATA-03 | Graceful degradation -- fallback to specificity ranking when facturatie unreachable | `getAllCostsForCountry()` returns `null` on error. `calculateAdvice()` checks for `null`, skips cost enrichment, sets `cost_data_available: false`. Pattern documented in Pattern 3 and Code Example 3. |
| ENG-02 | Country threading -- `calculateAdvice()` accepts `countryCode` from Picqer order | `countryCode` added as parameter to `calculateAdvice()` and API route. Value comes from `order.deliverycountry` via VerpakkingsClient. Fingerprint updated to include country. Timing fix documented in Pitfall 1 and Code Example 4. |
</phase_requirements>

## Key Implementation Details

### Join Key: `packagings.barcode` = `packaging_costs.sku`

The existing `syncPackagingCosts.ts` (line 12, 33) already validates this mapping. The `packagings` table has a `barcode` column (selected on line 26). The `packaging_costs` table has a `sku` column. Both use the format `55_XXX` (e.g., `55_949` for Surprise box). The cost provider uses the same join key.

**Caveat:** The engine's `PackagingMatch` interface (line 35-46) does NOT currently include `barcode`. It has `packaging_id` (UUID) and `idpackaging` (Picqer int ID). To look up costs, the cost provider either needs:
- (a) The barcode passed through `PackagingMatch` (add field in `matchCompartments`), or
- (b) A separate lookup from `packaging_id` -> barcode via the packagings query already done in `matchCompartments`

Option (a) is cleaner. Add `barcode: string | null` to `PackagingMatch` and populate it from the existing packagings query in `matchCompartments()` (line 351-356 already selects from packagings but doesn't include barcode -- add it to the select).

### Packaging Advice Table: New Columns Needed

The `packaging_advice` table needs two new columns for Phase 1:
- `country_code text` -- store which country the advice was calculated for
- `cost_data_available boolean DEFAULT true` -- flag indicating if cost data was available

These should be added as a migration before implementation. The deduplication query (line 913-920) doesn't need to change because the fingerprint itself now includes the country.

### Cache Data Size Estimation

From FACTURATIE_SPEC seed data:
- 22 packaging SKUs in `packaging_costs`
- 9 countries (NL, BE, DE, FR, AT, LU, SE, IT, ES)
- 2-3 carriers per box/country
- Only preferred + available rows cached
- Result: ~22 SKUs x 9 countries = ~198 entries (one per box/country with preferred carrier)
- Memory: trivial (< 50KB)

### Existing `total_cost` Field in PackagingMatch

The `PackagingMatch` interface already has a `total_cost` field (line 44). It's currently set to `(handling_cost ?? 0) + (material_cost ?? 0)` in `matchCompartments()` (line 416). In Phase 1, this field remains as-is. Phase 2 will change it to include transport costs. In Phase 1, we only establish the data layer -- the actual cost enrichment and ranking change happen in Phase 2.

However, for Phase 1 to be testable against success criteria, `getAllCostsForCountry()` must work and return correct data. The cost data is fetched and cached but not yet used for ranking (that's Phase 2).

### `delivery_country` Column Already Exists on `packing_sessions`

The session creation API (line 126 of `/api/verpakking/sessions/route.ts`) already stores `delivery_country` on the session if provided. This is currently optional. The `QueuePicklist` type (line 159 of `verpakking.ts`) already includes `deliverycountry`. This means country data is accessible at multiple points in the packing flow.

## Sources

### Primary (HIGH confidence)
- `src/lib/engine/packagingEngine.ts` -- Full engine: `calculateAdvice()` (line 894), `buildFingerprint()` (line 885), `matchCompartments()` (line 345), `rankPackagings()` (line 518), `PackagingMatch` interface (line 35)
- `src/lib/supabase/facturatieClient.ts` -- Facturatie Supabase client singleton (23 lines, verified working)
- `src/lib/supabase/syncPackagingCosts.ts` -- Existing cross-DB cost sync, validates `barcode = sku` join key
- `src/components/verpakking/VerpakkingsClient.tsx` -- Engine call (line 300), order fetch (line 260), `order.deliverycountry` display (line 1700)
- `src/app/api/verpakking/engine/calculate/route.ts` -- Current API contract (no `countryCode`)
- `.planning/FACTURATIE_SPEC.md` -- Complete schema + seed data for `packaging_costs`, `shipping_rates`

### Secondary (MEDIUM confidence)
- `src/lib/picqer/transform.ts` line 125 -- `bezorgland: order.deliverycountry || 'NL'` (country field transform)
- `src/lib/picqer/types.ts` line 63 -- `PicqerOrder.deliverycountry: string` (type definition)
- `src/hooks/usePicklistQueue.ts` -- `QueuePicklist` includes `deliverycountry` from picklist data
- `src/app/api/verpakking/sessions/route.ts` line 126 -- `delivery_country` already stored on sessions

### Tertiary (LOW confidence)
- Facturatie Supabase schema existence -- FACTURATIE_SPEC describes what should be created; actual creation status is unverified (Open Question 1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zero new dependencies; all libraries verified in `package.json` and existing code
- Architecture: HIGH -- `costProvider.ts` follows established singleton cache pattern from `facturatieClient.ts`; cross-DB join key validated by existing `syncPackagingCosts.ts`
- Pitfalls: HIGH -- All 5 pitfalls identified from direct line-by-line analysis of existing engine code and VerpakkingsClient component

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain, no moving parts)
