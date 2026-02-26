# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland, met correcte SKU mapping en gewichtsafhankelijke transportkosten.
**Current focus:** Phase 5 — Engine Optimization

## Current Position

Phase: 5 of 6 (Engine Optimization)
Plan: 1 of 3 in current phase (05-01 complete)
Status: Executing Phase 5
Last activity: 2026-02-26 — Completed 05-01 default product packaging

Progress: [█████████░] 90% (9/10 plans across all phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 8 (5 v1.0 + 3 v2.0)
- Average duration: 5min (v2.0 only)
- Total execution time: 15min (v2.0)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Cost Data Layer | 2 | — | — |
| 2. Cost-Primary Ranking | 2 | — | — |
| 3. API + UI Integration | 1 | — | — |
| 4. Cost Data Layer v2 | 3/3 | 15min | 5min |
| 5. Engine Optimization | 1/3 | 3min | 3min |

**Recent Trend:**
- v1.0 completed in 1 day (2026-02-24)
- v2.0 04-01 completed in 10min (2026-02-26)
- v2.0 04-02 completed in 3min (2026-02-26)
- v2.0 04-03 completed in 2min (2026-02-26)
- v2.0 05-01 completed in 3min (2026-02-26)
- Trend: Accelerating

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0]: Twee aparte apps met helder contract — facturatie berekent, batchmaker consumeert
- [v2.0]: `published_box_costs` als enig cross-DB contract
- [v2.0]: `facturatie_box_sku` als join key (niet barcode)
- [v2.0]: Pick/pack per doostype via box_pick_cost + box_pack_cost
- [v2.0]: Webhook voor cache invalidatie (niet Inngest)
- [v2.0]: Niet-greedy multi-box solver met 200ms timeout naar greedy fallback
- [04-01]: facturatie_box_sku as TEXT (not FK) since cross-database reference
- [04-01]: Same-as-barcode packagings get explicit facturatie_box_sku (not derived at runtime)
- [04-01]: 27 total seeded (6 mismatch + 21 same-as-barcode), 3 null (batchmaker-only)
- [04-02]: CostEntry[] per SKU for weight bracket support (PostNL has 4 brackets per SKU/country)
- [04-02]: enrichWithCosts uses NULL bracket by default; full weight selection deferred to 04-03
- [04-02]: SKU validation runs once per cache refresh cycle (validationDone flag)
- [04-03]: Two-pass cost enrichment: Pass 1 (enrichWithCosts) for ranking estimate, Pass 2 (refineBoxCostWithWeight) for actual weight
- [04-03]: Per-box independent weight calculation in all three paths (non-mixable, single-box, greedy multi-box)
- [04-03]: Products with no weight data treated as 0g with console warning
- [05-01]: Classified products fetched inline in products/status API (not separate endpoint)
- [05-01]: Default packaging dropdown only shown for classified products

### v1.0 Context (carried over)

- CostEntry re-exported from costProvider, canonical definition in verpakking.ts
- Country codes normalized to uppercase for consistent cache key matching
- parseFloat(String(...)) for numeric fields from Supabase
- countryCode optional on calculateAdvice() for backward compatibility
- enrichWithCosts excludes matches with facturatie_box_sku but no cost entry (v2: uses SKU not barcode)
- Cost display gated per-section, not per-banner
- EUR formatting via formatCost helper with undefined check

### Pending Todos

None yet.

### Blockers/Concerns

- [v2.0]: Facturatie app moet `published_box_costs` tabel bouwen en vullen voordat batchmaker v2 testbaar is

## Session Continuity

Last session: 2026-02-26
Stopped at: Completed 05-01-PLAN.md (default product packaging). Next: 05-02 or 05-03.
Resume with: /gsd:execute-phase 5
Resume file: .planning/phases/05-engine-optimization/05-02-PLAN.md

### Phase Execution Status
- Phase 4: 3 plans in 3 waves (04-01 → 04-02 → 04-03), all sequential deps
- Phase 5: 3 plans in 2 waves (05-01 + 05-02 parallel → 05-03)
- Phase 6: 1 plan in 1 wave (06-01)
