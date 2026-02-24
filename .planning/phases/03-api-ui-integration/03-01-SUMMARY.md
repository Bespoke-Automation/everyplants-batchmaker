---
phase: 03-api-ui-integration
plan: 01
subsystem: ui
tags: [react, tailwind, cost-display, packaging-engine, verpakkingsmodule]

# Dependency graph
requires:
  - phase: 02-cost-primary-ranking
    provides: "Cost-enriched AdviceBox with box_cost, transport_cost, total_cost fields"
provides:
  - "Cost breakdown display in VerpakkingsClient advice panel (collapsed + expanded)"
  - "Per-box cost in box selection modal"
  - "Amber warning when cost data unavailable"
  - "End-to-end verified: countryCode threading from order to engine API"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "formatCost helper for consistent EUR formatting"
    - "Conditional cost rendering gated on cost_data_available !== false"

key-files:
  created: []
  modified:
    - src/components/verpakking/VerpakkingsClient.tsx

key-decisions:
  - "Cost display gated per-section, not per-banner -- advice still useful without costs"
  - "EUR formatting via formatCost helper with undefined check (no EUR 0.00 for missing data)"
  - "No cost fields on BoxCard/session boxes -- costs live on engine advice only"

patterns-established:
  - "Cost display pattern: check cost_data_available !== false before rendering cost sections"
  - "Amber warning pattern: AlertTriangle icon + descriptive text for degraded-but-functional state"

requirements-completed: [API-01, UI-01]

# Metrics
duration: 3min
completed: 2026-02-24
---

# Phase 3 Plan 1: Cost Display in Advice UI + API Country Code Verification Summary

**Cost breakdown (doos + transport = totaal) zichtbaar in VerpakkingsClient advies-banner, expanded details en box-selectie modal, met amber waarschuwing bij ontbrekende kostdata**

## Performance

- **Duration:** ~3 min (Task 1 implementation + Task 2 human verification)
- **Started:** 2026-02-24T21:51:00Z
- **Completed:** 2026-02-24T22:58:00Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Cost breakdown per doos (dooskosten + transportkosten = totaalkosten) zichtbaar in expanded advice details
- Totale kosten samenvatting in collapsed advice banner (bijv. "Advies: Doos A (EUR 5.40 totaal)")
- Per-box kosten weergave in box selection modal buttons (emerald tekst)
- Amber waarschuwing wanneer cost_data_available === false ("Advies op basis van specificiteit")
- End-to-end geverifieerd: countryCode wordt automatisch meegegeven vanuit order.deliverycountry naar engine API

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cost display to VerpakkingsClient advice UI** - `a2f3d18` (feat)
2. **Task 2: Verify cost display and API country code end-to-end** - No commit (human-verify checkpoint, approved)

**Plan metadata:** (see final docs commit)

## Files Created/Modified
- `src/components/verpakking/VerpakkingsClient.tsx` - Added EngineAdviceBox cost fields (box_cost, transport_cost, total_cost), EngineAdvice cost_data_available flag, formatCost helper, cost display in collapsed banner, expanded details, box selection modal, and amber cost-unavailable warning

## Decisions Made
- Cost display gated per-section (not per-banner) -- advice is still useful without costs (specificity-based fallback)
- EUR formatting via formatCost helper with undefined check -- no EUR 0.00 shown for missing data
- No cost fields added to BoxCard or session boxes -- costs live on engine advice only, not on packing session state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- This is the final phase (Phase 3 of 3). All v1 requirements are now complete.
- The kostengeoptimaliseerd verpakkingsadvies system is fully operational:
  - Phase 1: Cost data layer with costProvider, country threading, graceful degradation
  - Phase 2: Cost-primary ranking in engine with enrichWithCosts
  - Phase 3: Cost display in packing UI with end-to-end verification
- v2 requirements (shadow mode, route filtering, multi-box optimization) are documented in REQUIREMENTS.md for future work

## Self-Check: PASSED

- FOUND: src/components/verpakking/VerpakkingsClient.tsx
- FOUND: commit a2f3d18
- FOUND: 03-01-SUMMARY.md

---
*Phase: 03-api-ui-integration*
*Completed: 2026-02-24*
