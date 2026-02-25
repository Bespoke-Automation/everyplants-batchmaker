# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland, met correcte SKU mapping en gewichtsafhankelijke transportkosten.
**Current focus:** Phase 4 — Cost Data Layer v2

## Current Position

Phase: 4 of 6 (Cost Data Layer v2)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-02-25 — Roadmap v2.0 created

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

Last session: 2026-02-25
Stopped at: Roadmap v2.0 created, ready to plan Phase 4
Resume file: .planning/ROADMAP.md
