---
phase: 04-cost-data-layer-v2
plan: 02
subsystem: engine, api
tags: [costProvider, published_box_costs, weight-brackets, cache-invalidation, facturatie]

# Dependency graph
requires:
  - phase: 04-cost-data-layer-v2
    plan: 01
    provides: "facturatie_box_sku column on packagings table with 27 seeded mappings"
provides:
  - "costProvider reading from published_box_costs via facturatie_box_sku"
  - "CostEntry with weight brackets, pick/pack costs, carrier, tariff class"
  - "selectCostForWeight() for weight bracket selection"
  - "SKU mapping validation at cache refresh"
  - "POST /api/verpakking/engine/cache-invalidate webhook endpoint"
  - "Engine using facturatie_box_sku instead of barcode for cost lookup"
affects: [04-03, packagingEngine, enrichWithCosts, UI cost display]

# Tech tracking
tech-stack:
  added: []
  patterns: ["CostEntry[] per SKU for weight bracket support", "selectCostForWeight for bracket selection", "SKU validation at cache refresh", "facturatie_box_sku as cost lookup key in engine"]

key-files:
  created:
    - "src/app/api/verpakking/engine/cache-invalidate/route.ts"
  modified:
    - "src/types/verpakking.ts"
    - "src/lib/engine/costProvider.ts"
    - "src/lib/engine/packagingEngine.ts"

key-decisions:
  - "CostEntry[] array per SKU to support multiple weight brackets per box/country combo"
  - "selectCostForWeight uses NULL bracket as fallback when no weight bracket matches"
  - "enrichWithCosts uses NULL bracket entry by default; full weight-based selection deferred to plan 04-03"
  - "SKU validation runs once per cache refresh cycle (not every call) via validationDone flag"
  - "Cache invalidation webhook has no auth (safe operation, internal network only)"

patterns-established:
  - "Map<country, Map<sku, CostEntry[]>> as cache structure for weight bracket support"
  - "selectCostForWeight() as the standard way to pick the right bracket for a given weight"
  - "facturatie_box_sku as the canonical cost lookup key (replacing barcode)"

requirements-completed: [COST-01, COST-02, COST-03, COST-04, SKU-03, DEGRAD-01, DEGRAD-03]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 4 Plan 2: costProvider Rewrite Summary

**costProvider rewritten to read from published_box_costs with weight bracket support, facturatie_box_sku lookup in engine, SKU validation at cache refresh, and webhook endpoint for cache invalidation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T15:11:44Z
- **Completed:** 2026-02-26T15:15:26Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- CostEntry type extended with 9 new fields: countryCode, tariffClass, weightBracket, isPallet, vehicleType, boxMaterialCost, boxPickCost, boxPackCost, calculatedAt (plus boxCost as v1 compatibility alias)
- costProvider completely rewritten: reads from published_box_costs instead of shipping_rates+packaging_costs, cache structure supports weight brackets (CostEntry[] per SKU), SKU mapping validation on each cache refresh
- Engine updated: enrichWithCosts uses facturatie_box_sku instead of barcode for cost lookup, all costMap type references updated to CostEntry[]
- Webhook endpoint at POST /api/verpakking/engine/cache-invalidate for facturatie-app to trigger cache refresh

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite CostEntry type and costProvider to read from published_box_costs** - `f2bf19e` (feat)
2. **Task 2: Update engine to use facturatie_box_sku lookup + add webhook endpoint** - `31802e2` (feat)

## Files Created/Modified
- `src/types/verpakking.ts` - Extended CostEntry with weight brackets, pick/pack costs, carrier, tariff class, pallet flag, vehicle type
- `src/lib/engine/costProvider.ts` - Full rewrite: published_box_costs query, CostEntry[] cache, selectCostForWeight(), validateSkuMappings()
- `src/lib/engine/packagingEngine.ts` - Added facturatie_box_sku to PackagingRow/PackagingMatch, updated enrichWithCosts and costMap types
- `src/app/api/verpakking/engine/cache-invalidate/route.ts` - New webhook endpoint for cache invalidation

## Decisions Made
- **CostEntry[] per SKU**: PostNL boxes have multiple weight brackets per SKU/country combination, so the cache stores arrays. DPD/pallet entries have NULL brackets and always match.
- **NULL bracket as default in enrichWithCosts**: For now, enrichWithCosts picks the NULL bracket entry (or first entry). Full weight-based bracket selection happens in plan 04-03 where box weight is calculated.
- **One-time validation per refresh**: SKU validation only runs once per cache refresh cycle (controlled by `validationDone` flag), avoiding repeated logs on every engine call.
- **No auth on cache-invalidate**: Cache invalidation is a safe, idempotent operation. The endpoint is internal network only and just resets an in-memory flag.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- costProvider reads from published_box_costs with all new fields
- Engine uses facturatie_box_sku for cost lookup (not barcode)
- selectCostForWeight() ready for plan 04-03 to use with actual box weights
- Cache invalidation webhook ready for facturatie-app integration
- Blocker remains: facturatie app must build and populate published_box_costs table before cost data is testable with real data

## Self-Check: PASSED

All 4 files verified present. Both commit hashes (f2bf19e, 31802e2) found in git log.

---
*Phase: 04-cost-data-layer-v2*
*Completed: 2026-02-26*
