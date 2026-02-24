# Stack Research

**Domain:** Cost-optimized packaging advice engine for multi-carrier warehouse shipping
**Researched:** 2026-02-24
**Confidence:** HIGH

## Executive Summary

This is NOT a real-time carrier rate-shopping problem. EveryPlants has **negotiated contract rates** with 4 carriers (PostNL, DPD, De Rooy, TOV) stored in an existing facturatie Supabase database. The carrier-per-box-per-country assignment is semi-static (changes quarterly at most). The optimization problem is: given N candidate packagings that fit an order's products, compute `box_cost + transport_cost(carrier, country) + handling` for each and pick the cheapest.

This means we need **zero new external dependencies**. The existing stack (Next.js 16, Supabase, TypeScript) is sufficient. The work is:
1. A cost-data service that reads from facturatie Supabase + caches in-memory
2. A carrier-routing lookup table (box + country -> carrier)
3. Modification of `rankPackagings()` to sort by total cost instead of specificity/volume/cost

## Recommended Stack

### Core Technologies (already in place -- no changes)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 16.1.1 | App framework | Already in use, no reason to change |
| Supabase JS | 2.90.1 | Database access (both batchmaker + facturatie) | Both clients already exist (`client.ts` + `facturatieClient.ts`) |
| TypeScript | 5.8.2 | Type safety | Already in use |

**Confidence: HIGH** -- Verified from `package.json` and existing codebase.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `Map` (built-in) | N/A | In-memory cost cache with TTL | Always -- for caching cost lookups from facturatie DB |

**No new npm dependencies needed.** The entire cost optimization is a data-lookup + sorting problem solvable with plain TypeScript.

### Development Tools (no changes)

| Tool | Purpose | Notes |
|------|---------|-------|
| Existing Supabase MCP | Schema exploration of facturatie DB | Use `mcp__supabase__execute_sql` to discover facturatie table structures |
| Existing dev server | Testing engine changes | `npm run dev` |

## Architecture Decision: Lookup Table vs Rate Shopping API

**Decision: Lookup table.** Confidence: HIGH.

| Approach | Fits EveryPlants? | Why |
|----------|-------------------|-----|
| Real-time carrier API rate shopping (like Sendcloud, Shippo, EasyPost) | NO | EveryPlants has negotiated contract rates, not public API rates. Carrier assignment per box/country is predetermined. |
| External multi-carrier SaaS (Cargoson, ShipWise, MetaShip) | NO | Overkill -- these solve dynamic carrier selection across dozens of carriers. We have 4 carriers with fixed assignments. |
| Internal lookup table + cost calculator | YES | Costs are in facturatie DB, carrier routing is semi-static, calculation is simple arithmetic. |

**Rationale:** The multi-carrier shipping software market (Cargoson, ShipWise, etc.) solves a different problem: dynamically selecting from many carriers per shipment. EveryPlants' problem is simpler -- the carrier is already determined by box type + destination country. We just need to factor that cost into the ranking.

## What to Build (new code, no new deps)

### 1. Cost Data Service (`src/lib/engine/costService.ts`)

**Purpose:** Read box costs + transport tariffs from facturatie Supabase, cache in-memory with 15-min TTL.

**Pattern:** Singleton cache with lazy loading, same pattern as `facturatieClient.ts` singleton.

```typescript
// Pseudocode structure
interface CostData {
  boxCosts: Map<string, number>         // barcode -> purchase_price_total
  transportRates: Map<string, number>   // `${carrier}:${boxType}:${country}` -> rate
  carrierRouting: Map<string, string>   // `${boxType}:${country}` -> carrier name
  handlingCost: number                  // per-product flat rate (configurable)
  loadedAt: number                      // timestamp for TTL
}

let cache: CostData | null = null
const TTL_MS = 15 * 60 * 1000  // 15 minutes

export async function getCostData(): Promise<CostData> { ... }
export function computeTotalCost(packaging: PackagingRow, country: string, productCount: number): number { ... }
```

**Confidence: HIGH** -- `facturatieClient.ts` already exists and works. `syncPackagingCosts.ts` already reads from `facturatie.boxes`. Transport tariffs are in the same facturatie database (schema needs exploration via Supabase MCP).

### 2. Carrier Routing Table (`batchmaker.carrier_routing` or in-code config)

**Purpose:** Map (packaging/box_type, destination_country) -> carrier.

**Decision pending:** Store in Supabase table (editable via UI) or as a TypeScript config object (editable via code). Recommend Supabase table for flexibility -- this data currently lives in Excel.

### 3. Modified `rankPackagings()` in `packagingEngine.ts`

**Current ranking:** specificity DESC -> volume ASC -> total_cost ASC
**New ranking:** total_cost ASC (where total_cost = box_cost + transport_cost + handling)

The existing `PackagingMatch.total_cost` field already exists and is computed as `handling_cost + material_cost`. We extend this to include transport cost based on destination country.

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| In-memory Map cache (15 min TTL) | Redis or Upstash Redis | Overkill for single-instance Next.js app with data that changes monthly. Map with TTL is simpler, zero cost, zero latency. |
| Direct Supabase read from facturatie | API wrapper / microservice | Unnecessary indirection. Supabase client already exists. Read-only access is fine. |
| Supabase table for carrier routing | Hardcoded TypeScript config | Table allows non-dev edits via future UI. Data originates from Excel, so DB is natural home. |
| Modify existing `rankPackagings()` | New separate ranking function | Existing function is the single ranking entry point. Modifying it keeps the engine cohesive. |
| Pass country to engine via order data | Separate country lookup step | `deliverycountry` is already on the Picqer order object that triggers the engine. Zero extra API calls. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Sendcloud / MyParcel / Shippo SDK | These are for dynamic carrier selection with public rates. EveryPlants has contract rates already in their database. Adding an external dependency adds cost, latency, and a point of failure for zero benefit. | Direct facturatie DB read |
| PostNL / DPD API for rate queries | Contract rates differ from public API rates. API calls add latency to real-time engine. | Pre-loaded cost cache from facturatie DB |
| Linear programming / OR-tools for optimization | The optimization is a simple sort-by-cost, not a complex constraint satisfaction problem. The compartment rules already handle constraint matching. | `Array.sort()` by total_cost |
| Separate cost microservice | Single-instance app, single database read, no need for service boundary. | In-process cost service module |
| node-cache / lru-cache npm packages | A plain `Map` + timestamp check is 10 lines of code. No need for a dependency. | Built-in `Map` with TTL check |

## Stack Patterns by Variant

**If carrier routing changes frequently (monthly+):**
- Store in `batchmaker.carrier_routing` Supabase table
- Build simple admin UI in `/verpakkingsmodule/instellingen`
- Cache with other cost data (15 min TTL)

**If carrier routing is very stable (yearly changes):**
- Store as TypeScript config in `src/lib/engine/carrierRouting.ts`
- Simpler, no DB overhead
- Requires code deploy to change

**Recommendation:** Start with Supabase table. The data comes from Excel, so giving it a DB home with future UI potential is the pragmatic choice. Confidence: MEDIUM (depends on business input on change frequency).

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| @supabase/supabase-js@2.90.1 | Facturatie Supabase instance | Already working -- `facturatieClient.ts` connects successfully |
| Next.js 16.1.1 | All proposed changes | Pure server-side TypeScript, no framework-specific concerns |

## Key Data Points to Explore (Phase 1 task)

Before building, the facturatie database schema must be explored to understand:
1. Which table holds transport tariffs (likely `transport_rates` or similar)
2. How rates are structured (per carrier? per country? per weight bracket? per box type?)
3. Whether surcharges (diesel, toll, oversized) are separate columns or included

Use `mcp__supabase__execute_sql` against the facturatie instance to discover this.

## Installation

```bash
# No new packages needed
# The entire cost optimization uses existing dependencies:
# - @supabase/supabase-js (already installed)
# - TypeScript built-ins (Map, Array.sort)
```

## Sources

- Codebase analysis: `src/lib/engine/packagingEngine.ts` -- existing engine with `rankPackagings()` sorting on specificity/volume/cost (HIGH confidence)
- Codebase analysis: `src/lib/supabase/facturatieClient.ts` -- existing facturatie Supabase connection (HIGH confidence)
- Codebase analysis: `src/lib/supabase/syncPackagingCosts.ts` -- existing box cost sync from `facturatie.boxes` table (HIGH confidence)
- Codebase analysis: `src/lib/picqer/types.ts` -- `deliverycountry` available on Picqer order (HIGH confidence)
- [Cargoson multi-carrier shipping software](https://www.cargoson.com/en/blog/top-multi-carrier-shipping-software-mcs-providers) -- confirmed real-time rate shopping is for dynamic carrier selection, not our use case (MEDIUM confidence)
- [PostNL rates 2025](https://www.postnl.nl/en/rates/) -- public rates exist but EveryPlants uses negotiated contract rates (MEDIUM confidence)
- [PostNL API costs](https://developer.postnl.nl/support/api-general/are-there-any-costs-being-charged-in-general-for-creating-shipments-ive-submitted-via-the-postnl-api/) -- API invoices on physical acceptance, not useful for pre-calculation (MEDIUM confidence)
- PROJECT.md -- confirmed facturatie Supabase as source of truth for all cost data (HIGH confidence)

---
*Stack research for: Cost-optimized packaging advice engine*
*Researched: 2026-02-24*
