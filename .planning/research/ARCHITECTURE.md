# Architecture Research: Cost-Optimized Packaging Engine

**Domain:** Packaging cost optimization for existing engine
**Researched:** 2026-02-24
**Confidence:** HIGH

## System Overview

```
                         ┌──────────────────────────────────────────────────┐
                         │              API Layer                           │
                         │  POST /api/verpakking/engine/calculate           │
                         │  POST /api/admin/sync-packaging-costs            │
                         └──────────────────┬───────────────────────────────┘
                                            │
                         ┌──────────────────▼───────────────────────────────┐
                         │           Packaging Engine                       │
                         │  src/lib/engine/packagingEngine.ts               │
                         │                                                  │
                         │  1. classifyOrderProducts()  (unchanged)         │
                         │  2. matchCompartments()      (unchanged)         │
                         │  3. rankPackagings()         (CHANGED: cost-first)│
                         │  4. solveMultiBox()          (CHANGED: uses cost) │
                         │  5. calculateAdvice()        (CHANGED: +country)  │
                         └────┬──────────┬──────────────────┬───────────────┘
                              │          │                  │
              ┌───────────────▼──┐  ┌────▼──────────┐  ┌───▼────────────────┐
              │  Batchmaker      │  │  Picqer        │  │  Cost Provider     │
              │  Supabase        │  │  API           │  │  (NEW)             │
              │                  │  │                │  │                    │
              │  packagings      │  │  orders        │  │  ┌──────────────┐ │
              │  compartment_    │  │  products      │  │  │ In-Memory    │ │
              │    rules         │  │  tags          │  │  │ Cache        │ │
              │  product_        │  │                │  │  │ (15min TTL)  │ │
              │    attributes    │  │                │  │  └──────┬───────┘ │
              │  packaging_      │  │                │  │         │         │
              │    advice        │  │                │  │  ┌──────▼───────┐ │
              └──────────────────┘  └────────────────┘  │  │ Facturatie   │ │
                                                        │  │ Supabase     │ │
                                                        │  │              │ │
                                                        │  │ packaging_   │ │
                                                        │  │   costs      │ │
                                                        │  │ shipping_    │ │
                                                        │  │   rates      │ │
                                                        │  └──────────────┘ │
                                                        └───────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| **Cost Provider** (NEW) | Fetches, caches, and serves cost data (box + transport) for a given packaging+country | Facturatie Supabase (read-only), Packaging Engine |
| **Packaging Engine** (modified) | Orchestrates classification, matching, ranking, and multi-box solving | Batchmaker Supabase, Picqer API, Cost Provider |
| **Engine Calculate API** (modified) | Accepts `countryCode` from caller, passes to engine | Packaging Engine |
| **Sync Packaging Costs API** (existing) | One-off sync of `material_cost` from facturatie `boxes` table | Facturatie Supabase, Batchmaker Supabase |
| **Facturatie Supabase Client** (existing) | Creates and caches a Supabase client for the facturatie database | Facturatie Supabase |

## Recommended Architecture: Cost Provider Module

### New file: `src/lib/engine/costProvider.ts`

This is the single new component. It owns all cross-database cost logic and exposes a simple interface to the engine.

**What:** A module-level singleton that fetches all cost data from facturatie Supabase, caches it in-memory with a 15-minute TTL, and exposes a `getTotalCost(barcode, countryCode)` lookup function.

**Why a dedicated module (not inline in the engine):**
1. **Separation of concerns** -- the engine should not know about cross-database queries
2. **Cache isolation** -- TTL logic stays contained, easy to test and tune
3. **Single fetch pattern** -- one bulk query loads everything; individual lookups are O(1) map reads

### Interface

```typescript
// src/lib/engine/costProvider.ts

export interface CostEntry {
  boxSku: string
  boxName: string
  boxCost: number          // packaging_costs.total_purchase_price
  transportCost: number    // shipping_rates.shipping_cost (preferred carrier)
  carrier: string          // which carrier is preferred
  totalCost: number        // boxCost + transportCost
}

// Main lookup: returns cost for a specific packaging+country, or null if no route
export async function getShippingCost(
  barcode: string,
  countryCode: string
): Promise<CostEntry | null>

// Bulk: returns all costs for a country (used by rankPackagings to compare)
export async function getAllCostsForCountry(
  countryCode: string
): Promise<Map<string, CostEntry>>  // keyed by box_sku (= packaging barcode)

// Force refresh (called by sync endpoint after manual cost updates)
export function invalidateCostCache(): void
```

### Cache Strategy

```typescript
// Module-level state (server process singleton in Next.js)
let costCache: Map<string, Map<string, CostEntry>> | null = null  // country -> sku -> CostEntry
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 15 * 60 * 1000  // 15 minutes

async function ensureCache(): Promise<Map<string, Map<string, CostEntry>>> {
  if (costCache && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return costCache
  }
  // Single query: all packaging_costs JOIN shipping_rates WHERE is_preferred AND is_available
  // ~22 packagings x ~9 countries x ~1.5 carriers = ~300 rows max
  costCache = await fetchAllCosts()
  cacheTimestamp = Date.now()
  return costCache
}
```

**Why this cache approach:**
- Cost data changes rarely (weekly at most when carrier variables update)
- ~300 rows total -- trivial memory footprint
- 15-minute TTL means worst case is 15 min stale data after a rate change
- Module-level singleton works because Next.js API routes share the same Node.js process
- `invalidateCostCache()` allows the sync endpoint to force refresh after manual updates

**Why NOT a different approach:**
- **Per-request fetch**: Too slow. Engine runs during packing -- must be instant.
- **Supabase real-time subscription**: Overkill. Costs change weekly, not in real-time.
- **Replicate to batchmaker Supabase**: Adds schema complexity and sync jobs. The existing `syncPackagingCosts` already syncs `material_cost` but that is box cost only -- transport costs are per-country and don't belong in the `packagings` table.
- **Redis/external cache**: No Redis in the stack. Adding infrastructure for ~300 rows is unjustified.

## Data Flow

### Engine Calculate Flow (modified)

```
Client (VerpakkingsClient)
    │
    │  POST /api/verpakking/engine/calculate
    │  body: { orderId, picklistId, products[], countryCode }
    │                                           ▲
    │                                           │ NEW: caller provides
    │                                           │ from order.deliverycountry
    ▼
calculateAdvice(orderId, picklistId, products, countryCode)
    │
    ├── 1. classifyOrderProducts(products)           → unchanged
    │       └── Supabase: product_attributes, shipping_units
    │
    ├── 2. matchCompartments(shippingUnits)           → unchanged
    │       └── Supabase: packagings, compartment_rules
    │
    ├── 3. enrichWithCosts(matches, countryCode)      → NEW STEP
    │       └── costProvider.getAllCostsForCountry(countryCode)
    │           └── (cache hit or facturatie Supabase query)
    │       └── For each PackagingMatch: look up barcode → set total_cost
    │
    ├── 4. rankPackagings(matches)                    → CHANGED ranking
    │       └── Primary: total_cost ASC (cheapest first)
    │       └── Tiebreak: specificity DESC, volume ASC
    │
    ├── 5. solveMultiBox(shippingUnits, matches)      → uses new ranking
    │       └── Greedy picks cheapest viable box first
    │
    └── 6. persist + return advice                    → store cost breakdown
```

### Where Country Code Comes From

The `VerpakkingsClient` component already has access to order data via the picklist. The Picqer order has `deliverycountry` (ISO 2-letter code). This is already transformed as `bezorgland` in `TransformedOrder`. The caller passes it to the engine calculate endpoint.

```
Picqer order.deliverycountry → TransformedOrder.bezorgland → API body.countryCode → engine
```

### Cost Enrichment Detail

The key integration point is a new `enrichWithCosts()` function called between `matchCompartments()` and `rankPackagings()`. This is where the cost provider plugs into the engine pipeline.

```typescript
// Inside calculateAdvice(), after matchCompartments:

async function enrichWithCosts(
  matches: PackagingMatch[],
  countryCode: string
): Promise<PackagingMatch[]> {
  const costs = await getAllCostsForCountry(countryCode)

  // Need barcode lookup: packaging_id → barcode
  // Already fetched in matchCompartments via packagings query
  // Pass barcode through PackagingMatch (add field) or do separate lookup

  return matches.map(match => {
    const costEntry = costs.get(match.barcode)  // barcode = packaging SKU
    if (!costEntry) {
      // No shipping route for this country → mark as unavailable
      return { ...match, total_cost: Infinity, route_available: false }
    }
    return {
      ...match,
      total_cost: costEntry.totalCost,  // box + transport
      box_cost: costEntry.boxCost,
      transport_cost: costEntry.transportCost,
      carrier: costEntry.carrier,
      route_available: true,
    }
  }).filter(match => match.route_available)  // Remove boxes that can't ship to this country
}
```

### Handling Cost (3rd cost layer)

Handling cost (`handling_cost` on `packagings` table) is already stored locally in batchmaker Supabase. It represents per-item handling labor. The total cost formula becomes:

```
total_cost = box_cost (facturatie) + transport_cost (facturatie) + handling_cost (local)
```

The `handling_cost` is already fetched in `matchCompartments()` as part of the packagings query. The enrichment step adds the facturatie costs on top.

## Component Boundaries

### What Stays Unchanged

| Component | Why Unchanged |
|-----------|---------------|
| `classifyOrderProducts()` | Product classification has nothing to do with costs |
| `matchCompartments()` | Rule matching determines which boxes CAN fit, not which is cheapest |
| `evaluateRuleGroup()` | Pure logic: does this box fit these products? |
| `buildProductList()` | Assigns products to boxes after selection |
| `applyTags()` | Tag writing is post-advice, independent of cost |
| `facturatieClient.ts` | Already exists and works |

### What Gets Modified

| Component | Change | Why |
|-----------|--------|-----|
| `rankPackagings()` | Ranking order: cost ASC primary, specificity DESC tiebreak | Business requirement: cheapest first |
| `solveMultiBox()` | Uses cost-ranked matches; no structural change | Follows from ranking change |
| `calculateAdvice()` | Accepts `countryCode` param; calls `enrichWithCosts()` between steps 2 and 3 | Needs country to look up transport costs |
| `PackagingMatch` interface | Add `barcode`, `box_cost`, `transport_cost`, `carrier` fields | Track cost breakdown for UI/logging |
| `PackagingAdviceResult` interface | Add cost breakdown per box | Store what the engine decided and why |
| Engine calculate API route | Accept `countryCode` in request body | Pass through to engine |

### What Gets Created

| Component | Location | Purpose |
|-----------|----------|---------|
| `costProvider.ts` | `src/lib/engine/costProvider.ts` | Cross-database cost lookup with in-memory cache |

## Patterns to Follow

### Pattern 1: Module-Level In-Memory Cache

**What:** Singleton cache at module scope, shared across all requests in the same Node.js process.
**When to use:** Data changes rarely, dataset is small, read frequency is high.
**Trade-offs:** Simple and fast; stale for up to TTL duration; resets on server restart (fine for cost data).

```typescript
let cache: T | null = null
let timestamp = 0
const TTL = 15 * 60 * 1000

async function getWithCache(): Promise<T> {
  if (cache && Date.now() - timestamp < TTL) return cache
  cache = await fetchFromSource()
  timestamp = Date.now()
  return cache
}
```

This pattern already exists in the codebase: `facturatieClient.ts` uses a module-level singleton for the Supabase client. The Picqer client uses 30-second in-memory caching for orders. Cost caching follows the same established pattern.

### Pattern 2: Pipeline Enrichment Step

**What:** Insert a new step into an existing sequential pipeline without restructuring.
**When to use:** Adding a cross-cutting concern (cost data) to an existing flow.
**Trade-offs:** Minimal disruption to existing code; clear where the new logic lives.

The engine pipeline is: classify -> match -> rank -> solve -> persist. Cost enrichment slots in as a new step between match and rank. This preserves the existing structure and makes the change easy to review and revert.

### Pattern 3: Filter-on-Unavailable

**What:** After enrichment, remove matches where shipping is not available for the target country.
**When to use:** Not all box+country combinations have a valid route.
**Trade-offs:** Reduces match set before ranking, which is correct behavior (don't suggest a box that can't be shipped).

From the seed data: Fold box 180 cannot ship to France. The enrichment step sets these to `Infinity` cost and filters them out before ranking. This is more robust than relying on cost-based sorting alone.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Replicate All Cost Data to Batchmaker Supabase

**What people do:** Create `shipping_rates` and `packaging_costs` mirror tables in the batchmaker schema, run a periodic sync job.
**Why it's wrong:** Doubles the maintenance surface. Two sources of truth for the same data. The existing `syncPackagingCosts` that syncs `material_cost` is already a limited form of this and creates confusion (local cost vs. facturatie cost).
**Do this instead:** Read directly from facturatie Supabase with in-memory caching. The facturatie client already exists.

### Anti-Pattern 2: Fetch Costs Per-Box Inside the Ranking Loop

**What people do:** Call `getShippingCost(barcode, country)` inside `rankPackagings()` for each match.
**Why it's wrong:** N+1 query pattern. Even with caching, it's unnecessary overhead and makes the ranking function async when it should be pure.
**Do this instead:** Bulk-fetch all costs for the country once, then enrich all matches in one pass before ranking.

### Anti-Pattern 3: Make Country Code Optional with NL Fallback

**What people do:** Default to NL if no country provided, to maintain backward compatibility.
**Why it's wrong:** Silently gives wrong advice for international orders. The whole point of cost optimization is per-country accuracy.
**Do this instead:** Require `countryCode` in the API. The caller always has it (from order.deliverycountry). If missing, return a clear error.

### Anti-Pattern 4: Include Handling Cost in Facturatie Data

**What people do:** Add handling costs to the facturatie database alongside box and transport costs.
**Why it's wrong:** Handling cost is operational (varies by packing setup), not financial. It belongs in the batchmaker engine config, not the invoicing database.
**Do this instead:** Keep handling_cost on the local `packagings` table. Sum all three layers in the engine: `facturatie.box_cost + facturatie.transport_cost + local.handling_cost`.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Facturatie Supabase | Direct query via `getFacturatieSupabase()` + in-memory cache | Read-only. ~300 rows. 15min TTL. |
| Picqer API | Existing `rateLimitedFetch()` | No changes needed for cost optimization |
| Batchmaker Supabase | Existing `.schema('batchmaker')` pattern | Store cost breakdown in `packaging_advice` |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Engine <-> Cost Provider | Direct function call (`getAllCostsForCountry`) | Same process, synchronous after cache load |
| API Route <-> Engine | `calculateAdvice(orderId, picklistId, products, countryCode)` | Add countryCode parameter |
| UI Component <-> API | POST body gains `countryCode` field | Caller extracts from order data |
| Sync endpoint -> Cost cache | `invalidateCostCache()` after sync | Optional: force refresh after manual cost update |

## Suggested Build Order

Dependencies between components dictate this order:

### Phase 1: Cost Provider (foundation, no engine changes yet)

1. Create `src/lib/engine/costProvider.ts` with cache + facturatie queries
2. Add types: `CostEntry` interface
3. Unit test: mock facturatie client, verify cache TTL behavior, verify lookup accuracy
4. **Why first:** Everything else depends on this. Can be built and tested in isolation.

### Phase 2: Engine Integration (wire cost provider into pipeline)

1. Add `barcode` field to `PackagingMatch` interface (populated in `matchCompartments`)
2. Create `enrichWithCosts()` function
3. Modify `calculateAdvice()` to accept `countryCode` and call enrichment
4. Modify `rankPackagings()` to sort by `total_cost ASC` primary
5. Add cost breakdown fields to `PackagingAdviceResult`
6. **Why second:** Depends on Phase 1. Core logic change. Must be tested with real cost data.

### Phase 3: API + Caller Changes (expose to UI)

1. Update engine calculate API route to accept and validate `countryCode`
2. Update `VerpakkingsClient` / `usePackingSession` to pass `countryCode` from order data
3. Update `packaging_advice` table to store cost breakdown (migration)
4. Wire `invalidateCostCache()` into the sync-packaging-costs endpoint
5. **Why third:** Depends on Phase 2. Thin integration layer, low risk.

### Phase 4: Verification + Refinement

1. End-to-end test: NL order, DE order, FR order (with Fold box 180 exclusion)
2. Verify multi-box cost optimization (sum of box costs, not just first box)
3. Compare engine output before/after for a sample of real orders
4. **Why last:** Validation requires all components working together.

## Key Data Relationships

```
batchmaker.packagings.barcode  ═══  facturatie.packaging_costs.sku
                                         │
                                    facturatie.shipping_rates.box_sku
                                         │
                              (box_sku, country_code, carrier) UNIQUE
                              is_preferred = true → engine uses this rate
```

The join key between the two databases is **packaging barcode/SKU**. This is already used by `syncPackagingCosts.ts` (line 38: `facturatie.boxes.sku` matched to `batchmaker.packagings.barcode`). The same key works for the new cost provider.

## Sources

- `src/lib/engine/packagingEngine.ts` -- existing engine (1200 lines, fully read)
- `src/lib/supabase/facturatieClient.ts` -- existing facturatie client (singleton pattern)
- `src/lib/supabase/syncPackagingCosts.ts` -- existing box cost sync (barcode=SKU join key)
- `.planning/FACTURATIE_SPEC.md` -- full schema + seed data for `packaging_costs`, `shipping_rates`, `carrier_variables`
- `.planning/PROJECT.md` -- project requirements and cost structure definition
- `.planning/codebase/ARCHITECTURE.md` -- current system architecture layers and data flows
- `src/lib/picqer/transform.ts` line 125 -- `bezorgland: order.deliverycountry || 'NL'`

---
*Architecture research for: Cost-Optimized Packaging Engine*
*Researched: 2026-02-24*
