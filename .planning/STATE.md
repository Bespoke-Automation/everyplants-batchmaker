# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-25)

**Core value:** De engine adviseert altijd de verpakkingsoptie met de laagste totaalkosten (doos + pick/pack + transport) per bestemmingsland.
**Current focus:** Milestone v2.0 — Defining requirements

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-02-25 — Milestone v2.0 started

Progress: [░░░░░░░░░░] 0%

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v2.0]: Twee aparte apps met helder contract — facturatie berekent, batchmaker consumeert
- [v2.0]: `published_box_costs` als enig cross-DB contract
- [v2.0]: `facturatie_box_sku` als join key (niet barcode)
- [v2.0]: Pick/pack per doostype via box_pick_cost + box_pack_cost
- [v2.0]: Webhook voor cache invalidatie (niet Inngest)
- [v2.0]: Niet-greedy multi-box solver met 200ms timeout → greedy fallback

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
Stopped at: Milestone v2.0 initialized, defining requirements
Resume file: .planning/REQUIREMENTS.md
