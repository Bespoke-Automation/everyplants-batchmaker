# Project Research Summary

**Project:** Cost-Optimized Packaging Advice Engine — EveryPlants Batchmaker
**Domain:** Warehouse cost optimization (internal operations tool)
**Researched:** 2026-02-24
**Confidence:** HIGH

## Executive Summary

This project extends an existing packaging advice engine to recommend boxes based on total cost (material + transport + handling) instead of the current specificity/volume ranking. The core insight from research is that this is NOT a real-time carrier rate-shopping problem — EveryPlants has negotiated fixed-rate contracts with 4 carriers stored in a separate facturatie Supabase database. The optimization is a data-lookup and sort problem, requiring zero new npm dependencies. The entire change consists of one new module (`costProvider.ts`), three modified functions in the existing engine, and a new parameter threaded through the API call chain.

The recommended approach is a 4-phase build: first establish the cost data layer (read from facturatie Supabase with in-memory cache), then integrate it into the engine pipeline via an enrichment step between `matchCompartments()` and `rankPackagings()`, then expose country code through the API and UI layers, and finally validate with shadow-mode comparison before going fully live. This order is strictly dictated by data dependencies: ranking cannot work without cost data, cost data requires country code, country code must be threaded from the Picqer order through to the engine.

The key risks are silent failures: a missing country parameter defaulting to NL (giving wrong advice for all international orders), unavailable shipping routes being treated as zero-cost (recommending boxes that cannot actually ship to a destination), and the fingerprint-based deduplication cache serving stale advice across countries. All three must be addressed in Phase 1 before any ranking changes are made. The rollout risk (switching ranking for 100% of orders at once) is mitigated by a `ranking_mode` flag that enables shadow-mode logging before live activation.

## Key Findings

### Recommended Stack

No new dependencies are needed. The existing stack — Next.js 16.1.1, Supabase JS 2.90.1, TypeScript 5.8.2 — is fully sufficient. The facturatie Supabase client (`facturatieClient.ts`) already exists and connects successfully. The cost data infrastructure (`syncPackagingCosts.ts`) already shows the exact pattern to follow. The only new code is a single `costProvider.ts` module using a built-in `Map` for in-memory caching.

**Core technologies:**
- **Next.js 16.1.1**: App framework — already in use, no changes
- **Supabase JS 2.90.1**: Database access for both batchmaker and facturatie instances — both clients exist
- **TypeScript 5.8.2**: Type safety — already in use
- **Built-in `Map`**: In-memory cost cache with 15-min TTL — no npm package needed

**Decision rationale:** External multi-carrier SaaS (Cargoson, ShipWise) and carrier APIs (PostNL, DPD) were evaluated and rejected. EveryPlants' carrier assignment per box/country is contractually fixed — dynamic rate shopping solves a different problem. The facturatie database is the authoritative source for all cost data.

### Expected Features

**Must have (table stakes — v1):**
- **Destination country passed to engine** — without this, transport costs cannot be looked up
- **Carrier-box-country mapping** — Supabase table seeded from current Excel (~30 rows)
- **Transport cost reader from facturatie** — follows existing `syncPackagingCosts.ts` pattern
- **In-memory cost cache (15 min TTL)** — prevents latency during real-time packing sessions
- **Cost-based ranking** — change `rankPackagings()` sort to total_cost ASC primary
- **Fallback when costs missing** — revert to specificity ranking with warning flag, not a crash
- **Single-product order validation** — engine likely already handles this, needs verification

**Should have (v1.x — after validation):**
- **Cost breakdown in UI** — show material/transport/handling split per advised box; builds worker trust
- **Automatic daily cost sync** — Inngest cron replacing manual admin trigger
- **Carrier override UI** — CRUD in instellingen for carrier-box-country mappings

**Defer (v2+):**
- **Multi-box cost optimization (non-greedy)** — only if greedy solver produces observably suboptimal splits
- **Weight-based transport tiers** — only if flat-rate-per-box proves inaccurate
- **Cost savings dashboard** — only if management requests historical data

### Architecture Approach

The architecture is a minimal extension of the existing engine pipeline. A new `costProvider.ts` module sits between the engine and the facturatie Supabase, owning all cross-database cost logic. It exposes `getAllCostsForCountry(countryCode)` which the engine calls in a new `enrichWithCosts()` step inserted between `matchCompartments()` and `rankPackagings()`. The join key between databases is the packaging barcode/SKU — already validated by the existing `syncPackagingCosts.ts`. All other engine components remain unchanged.

**Major components:**
1. **Cost Provider** (`src/lib/engine/costProvider.ts`) — NEW: fetches, caches, and serves cost data per packaging+country from facturatie Supabase; 15-min TTL in-memory cache; `invalidateCostCache()` for post-sync refresh
2. **Packaging Engine** (`src/lib/engine/packagingEngine.ts`) — MODIFIED: `calculateAdvice()` gains `countryCode` param; new `enrichWithCosts()` step; `rankPackagings()` sort order changed to cost-primary; `PackagingMatch` interface gains cost breakdown fields
3. **Engine Calculate API** (`/api/verpakking/engine/calculate`) — MODIFIED: accepts and validates `countryCode` in request body; passes through to engine
4. **VerpakkingsClient / usePackingSession** — MODIFIED: extracts `deliverycountry` from Picqer order and passes to API call

**Key data flow:**
```
Picqer order.deliverycountry → TransformedOrder.bezorgland → API body.countryCode → engine
engine → costProvider.getAllCostsForCountry() → facturatie.packaging_costs JOIN shipping_rates
enrichWithCosts() → PackagingMatch[].total_cost set → rankPackagings() sorts by cost ASC
```

### Critical Pitfalls

1. **Country not passed to engine** — Make `countryCode` a required parameter everywhere; validate and reject rather than defaulting to NL. Picqer order `deliverycountry` must be fetched via separate API call from picklist (picklists don't include delivery address). Address in Phase 1.

2. **Unavailable routes treated as zero-cost** — Filter `is_available = true` in the facturatie query; treat NULL results as "route unavailable" and exclude the packaging from candidates entirely. The FACTURATIE_SPEC shows Fold box 180 has no route to France — the engine must not recommend it. Address in Phase 1.

3. **Fingerprint deduplication ignores country** — Include `countryCode` in `buildFingerprint()` or add `country_code` column to `packaging_advice` deduplication query. Same products to NL vs DE need different cached advice. Address in Phase 1.

4. **Cross-database failure silently breaks engine** — Pre-fetch all cost data at first call; if facturatie is unreachable, fall back to specificity ranking with `cost_data_available: false` flag on result. Log failures prominently. Address in Phase 1.

5. **Ranking change without A/B comparison** — Add `ranking_mode` flag; run cost-ranked advice in shadow mode for 1-2 weeks before activating; use `feedbackTracking.ts` to compare override rates. Address in Phase 3.

## Implications for Roadmap

Based on research, the natural phase structure follows strict data dependencies — each phase unlocks the next.

### Phase 1: Cost Data Layer
**Rationale:** Everything depends on this. Cost provider must exist before ranking changes can be made. Country threading, fingerprint fix, and graceful degradation must all be correct before any engine output changes.
**Delivers:** `costProvider.ts` with in-memory cache; country code threaded from Picqer order to engine API; updated fingerprint including country; fallback behavior when facturatie is unreachable; carrier-box-country Supabase table seeded from Excel
**Addresses:** Destination country awareness, carrier-box-country mapping, transport cost lookup, in-memory cost cache, fallback behavior
**Avoids:** Country NL-silent-fallback pitfall, unavailable-route-as-zero-cost pitfall, fingerprint-ignores-country pitfall, cross-DB-failure pitfall

### Phase 2: Ranking Logic
**Rationale:** Can only be built after Phase 1 cost data is available and tested. This is the core algorithmic change — modify `rankPackagings()` to sort by total_cost ASC with specificity/volume as tiebreakers.
**Delivers:** Modified `rankPackagings()` with cost-primary sort; `enrichWithCosts()` integration step in `calculateAdvice()`; updated `PackagingMatch` and `PackagingAdviceResult` types with cost breakdown fields; multi-box cost aggregation verification
**Uses:** `costProvider.getAllCostsForCountry()` from Phase 1
**Implements:** Engine pipeline enrichment pattern; filter-on-unavailable pattern
**Avoids:** Multi-box cost suboptimality pitfall (verify greedy approach handles cost correctly)

### Phase 3: API + UI Integration
**Rationale:** Thin integration layer, but must come after engine is correct. Exposes new behavior to the packing interface and adds shadow-mode capability for safe rollout.
**Delivers:** Updated engine calculate API route accepting `countryCode`; updated VerpakkingsClient/usePackingSession passing country from order data; `packaging_advice` table migration adding `country_code` and cost breakdown columns; `ranking_mode` shadow flag; `invalidateCostCache()` wired to sync endpoint
**Avoids:** Ranking-change-without-validation pitfall

### Phase 4: Validation + Rollout
**Rationale:** Validation must happen with real data before full activation. Shadow mode runs alongside the old ranking; comparison uses existing `feedbackTracking.ts` infrastructure.
**Delivers:** Shadow mode enabled for 1-2 weeks; feedback tracking comparison (override rates before/after); go/no-go decision on full activation; cost breakdown UI display (material/transport/handling per advised box)

### Phase Ordering Rationale

- **Data before logic:** Transport cost data must exist before ranking can use it. Country parameter must be threaded before cost data can be looked up. This is a strict dependency chain.
- **Correctness before exposure:** Engine changes (Phase 2) must be validated before the UI exposes them (Phase 3). API contract changes are cheap; fixing bad advice after workers trust it is expensive.
- **Shadow before live:** The existing `feedbackTracking.ts` infrastructure enables shadow-mode comparison at no extra cost. Using it avoids a "big bang" ranking switch that could break worker confidence in the engine.
- **Phase 1 is the hardest:** Most pitfalls are in the data layer — country threading, unavailable route handling, fingerprint update, graceful degradation. Getting these right means Phases 2-4 are low risk.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** Facturatie database schema must be explored before building the cost provider — the transport tariff table structure is documented in FACTURATIE_SPEC.md but the exact query shape (joins, filters, column names) needs validation against the live schema. Use `mcp__supabase__execute_sql` against the facturatie instance.
- **Phase 1:** Picqer order country retrieval path from a picklist context needs verification — picklists reference `idorder` but delivery address is on the order object. Confirm the Picqer API call pattern.

Phases with standard patterns (skip research-phase):
- **Phase 2:** `rankPackagings()` change is a well-understood sort comparator modification. Pattern is clear from existing code.
- **Phase 3:** API route and UI component changes follow existing codebase conventions exactly.
- **Phase 4:** `feedbackTracking.ts` already exists — shadow mode is a flag addition, not new infrastructure.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified from package.json and existing codebase. Zero new dependencies confirmed. |
| Features | HIGH | Based on direct codebase analysis of existing engine + facturatie schema spec. Dependency chain is clear. |
| Architecture | HIGH | Existing `syncPackagingCosts.ts` validates the cross-DB pattern. Join key (barcode/SKU) confirmed working. |
| Pitfalls | HIGH | All 6 pitfalls identified from direct code analysis, not speculation. Line numbers cited. |

**Overall confidence:** HIGH

### Gaps to Address

- **Facturatie transport tariff table shape:** FACTURATIE_SPEC.md documents the schema, but the live facturatie database should be queried to confirm column names, data completeness, and whether all current carriers/countries are present. Do this as the first task in Phase 1.
- **Carrier routing change frequency:** STACK.md recommends a Supabase table for carrier-box-country mappings (vs hardcoded config) because the data comes from Excel. Confirm with ops team how often this mapping changes — if truly yearly, a TypeScript config is simpler.
- **Handling cost uniformity assumption:** FEATURES.md defers per-product-type handling costs as marginal. Validate with warehouse team that handling cost is indeed uniform across product types before committing to the flat-rate approach.

## Sources

### Primary (HIGH confidence)
- `src/lib/engine/packagingEngine.ts` — full engine implementation (1200 lines), ranking logic, multi-box solver, fingerprint deduplication
- `src/lib/supabase/facturatieClient.ts` — existing facturatie connection (singleton pattern)
- `src/lib/supabase/syncPackagingCosts.ts` — existing cross-DB cost sync (join key validation)
- `src/lib/engine/feedbackTracking.ts` — outcome measurement infrastructure
- `.planning/FACTURATIE_SPEC.md` — complete facturatie schema with seed data (packaging_costs, shipping_rates, carrier_variables)
- `.planning/PROJECT.md` — requirements, constraints, carrier descriptions

### Secondary (MEDIUM confidence)
- `src/lib/picqer/transform.ts` — country field transformation (`bezorgland: order.deliverycountry || 'NL'`)
- `src/app/api/verpakking/engine/calculate/route.ts` — current API contract
- `src/types/verpakking.ts` — DeliveryAddress type with countryCode field

### Tertiary (MEDIUM confidence)
- Cargoson multi-carrier shipping software landscape — confirmed real-time rate shopping is not applicable to EveryPlants' use case
- PostNL API documentation — confirmed contract rates differ from public API rates; direct API integration rejected

---
*Research completed: 2026-02-24*
*Ready for roadmap: yes*
