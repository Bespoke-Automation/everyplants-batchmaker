---
phase: 04-cost-data-layer-v2
plan: 03
subsystem: engine
tags: [weight-brackets, PostNL, cost-enrichment, per-box-weight, packagingEngine]

# Dependency graph
requires:
  - phase: 04-cost-data-layer-v2
    plan: 02
    provides: "costProvider with selectCostForWeight(), CostEntry[] per SKU, facturatie_box_sku lookup"
provides:
  - "Weight-aware cost enrichment in packagingEngine via refineBoxCostWithWeight"
  - "Per-box weight calculation from product_attributes.weight"
  - "AdviceBox with weight_grams and weight_bracket fields"
  - "PostNL bracket selection (0-5kg, 5-10kg, 10-20kg, 20-30kg) based on actual box weight"
affects: [05-02, 06-01, VerpakkingsClient, EngineLog, UI cost display]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Two-pass cost enrichment: Pass 1 (enrichWithCosts) for ranking estimate, Pass 2 (refineBoxCostWithWeight) for actual weight", "Per-box independent weight calculation in multi-box scenarios"]

key-files:
  created: []
  modified:
    - "src/lib/engine/packagingEngine.ts"

key-decisions:
  - "Two-pass approach: enrichWithCosts uses NULL/first bracket for ranking, refineBoxCostWithWeight uses actual weight after product assignment"
  - "Weight calculated per box independently in all three paths: non-mixable single, mixable single-box, greedy multi-box"
  - "Products with no weight data treated as 0g with console warning (acceptable for composition parts)"
  - "Task 2 was verification-only (build pass) with no additional code changes needed"

patterns-established:
  - "refineBoxCostWithWeight() as standard post-assignment cost refinement for weight-bracketed carriers"
  - "calculateBoxWeight() for summing product weights per box from weightMap"
  - "AdviceBox.weight_grams + weight_bracket as standard weight tracking fields on advice output"

requirements-completed: [WEIGHT-01, WEIGHT-02, WEIGHT-03]

# Metrics
duration: 2min
completed: 2026-02-26
---

# Phase 4 Plan 3: Weight Bracket Calculation Summary

**Weight-aware cost enrichment in packaging engine: per-box weight calculation from product_attributes, PostNL bracket selection (0-5kg to 20-30kg), DPD/pallet NULL bracket passthrough, and independent per-box weight in multi-box orders**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-26T15:18:54Z
- **Completed:** 2026-02-26T15:21:24Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added weight_grams and weight_bracket fields to AdviceBox interface for tracking per-box weight and selected bracket
- Implemented calculateBoxWeight() helper that sums product weights from the existing mixableMap/weightMap
- Implemented refineBoxCostWithWeight() that selects the correct PostNL bracket using selectCostForWeight from costProvider
- Threaded weight refinement through all three box creation paths in solveMultiBox: non-mixable single boxes, mixable single-box match, and greedy multi-box split
- Full production build verified passing with all import chains intact

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement weight-aware cost enrichment in the engine** - `b98a276` (feat)
2. **Task 2: Verify full compilation and update PackagingAdviceResult** - No code changes (verification-only: build passes, import chains intact)

## Files Created/Modified
- `src/lib/engine/packagingEngine.ts` - Added AdviceBox weight fields, calculateBoxWeight(), refineBoxCostWithWeight(), weight map building in solveMultiBox, and weight refinement calls on all box creation paths

## Decisions Made
- **Two-pass cost enrichment**: Pass 1 (enrichWithCosts before ranking) uses NULL bracket or first entry as initial estimate. Pass 2 (refineBoxCostWithWeight after product assignment) recalculates with actual weight. This is necessary because weight is unknown until products are assigned to specific boxes.
- **Per-box independence**: Each box calculates its own weight from its own product list, supporting multi-box orders where different boxes may fall in different weight brackets.
- **Zero-weight fallback**: Products without weight data (null/0) are treated as 0g with a console warning. Composition parts placeholder entries are silently treated as 0g. This is acceptable because compositions are already partially classified and exact weight is tracked on the real product entries.
- **No DB migration needed**: weight_grams and weight_bracket are optional fields on AdviceBox which is stored as JSONB in packaging_advice.advice_boxes. The extra fields are simply included in the JSON.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (Cost Data Layer v2) is now COMPLETE: SKU mapping, costProvider rewrite, and weight bracket calculation all done
- Engine pipeline: classifyOrderProducts -> matchCompartments -> enrichWithCosts(Pass 1) -> rankPackagings -> solveMultiBox(with refineBoxCostWithWeight Pass 2) -> persist
- Ready for Phase 5: Engine Optimization (non-greedy solver, single-SKU fast path, ranking with pick/pack costs)
- Blocker remains: facturatie app must build and populate published_box_costs table before cost data is testable with real data

## Self-Check: PASSED

All 1 modified file verified present. Commit hash (b98a276) found in git log. SUMMARY.md created.

---
*Phase: 04-cost-data-layer-v2*
*Completed: 2026-02-26*
