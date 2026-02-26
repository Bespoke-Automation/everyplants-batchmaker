# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland, met correcte SKU mapping en gewichtsafhankelijke transportkosten.
**Current focus:** Phase 4 — Cost Data Layer v2

## Current Position

Phase: 4 of 6 (Cost Data Layer v2)
Plan: 0 of 3 in current phase (all 3 planned, ready to execute)
Status: Ready to execute Phase 4
Last activity: 2026-02-26 — All phases (4,5,6) planned and verified

Progress: [█████░░░░░] 50% (5/10 plans across all phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 5 (v1.0)
- Average duration: — (not tracked in v1.0)
- Total execution time: — (not tracked in v1.0)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Cost Data Layer | 2 | — | — |
| 2. Cost-Primary Ranking | 2 | — | — |
| 3. API + UI Integration | 1 | — | — |

**Recent Trend:**
- v1.0 completed in 1 day (2026-02-24)
- Trend: Stable

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

### v1.0 Context (carried over)

- CostEntry re-exported from costProvider, canonical definition in verpakking.ts
- Country codes normalized to uppercase for consistent cache key matching
- parseFloat(String(...)) for numeric fields from Supabase
- countryCode optional on calculateAdvice() for backward compatibility
- enrichWithCosts excludes matches with barcode but no cost entry
- Cost display gated per-section, not per-banner
- EUR formatting via formatCost helper with undefined check

### Pending Todos

None yet.

### Blockers/Concerns

- [v2.0]: Facturatie app moet `published_box_costs` tabel bouwen en vullen voordat batchmaker v2 testbaar is
- [v2.0]: costProvider.ts moet herschreven worden — v1 leest van verkeerde tabellen

## Session Continuity

Last session: 2026-02-26
Stopped at: All 3 phases planned + verified. Phase 4 execute-phase initialized, ready to spawn Wave 1 (plan 04-01).
Resume with: /gsd:execute-phase 4
Resume file: .planning/phases/04-cost-data-layer-v2/04-01-PLAN.md

### Phase Execution Status
- Phase 4: 3 plans in 3 waves (04-01 → 04-02 → 04-03), all sequential deps
- Phase 5: 3 plans in 2 waves (05-01 + 05-02 parallel → 05-03)
- Phase 6: 1 plan in 1 wave (06-01)
