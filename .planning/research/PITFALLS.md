# Pitfalls Research

**Domain:** Cost-optimized packaging advice for plant e-commerce logistics
**Researched:** 2026-02-24
**Confidence:** HIGH (based on direct codebase analysis of existing engine, facturatie schema spec, and Picqer integration patterns)

## Critical Pitfalls

### Pitfall 1: Country Not Passed to Engine — Silent NL Fallback

**What goes wrong:**
The current `calculateAdvice()` function signature does not accept a `countryCode` parameter. The engine calculate API route (`/api/verpakking/engine/calculate`) also does not accept or pass country information. When cost-based ranking is added, the engine needs the destination country to look up shipping rates. Without an explicit country parameter, the engine will either crash or silently default to 'NL', producing wrong cost rankings for all international orders.

**Why it happens:**
The current engine ranks on specificity/volume/material_cost only — none of these are country-dependent. Country data exists on the Picqer order (`order.deliverycountry`, transformed as `bezorgland` in `transform.ts`), but the packing session flow calls the engine from the VerpakkingsClient component which works at picklist level, not order level. The order's delivery country must be threaded through: picklist -> order -> country -> engine.

**How to avoid:**
1. Add `countryCode: string` as required parameter to `calculateAdvice()` and the `/api/verpakking/engine/calculate` route
2. In the calling code (usePackingSession / VerpakkingsClient), fetch the order's `deliverycountry` from Picqer when starting a packing session
3. Add explicit validation: reject engine calls without a country code rather than defaulting
4. Add a test: engine called without country must throw, not silently return NL prices

**Warning signs:**
- Engine returns identical cost rankings regardless of destination country
- International orders (DE, FR, BE) get the same box recommendations as NL orders
- No `country_code` field visible in `packaging_advice` table records

**Phase to address:**
Phase 1 — Data layer / cost fetching. This must be wired before any ranking logic changes.

---

### Pitfall 2: Unavailable Routes Treated as Zero-Cost Instead of Excluded

**What goes wrong:**
The FACTURATIE_SPEC shows explicit unavailable routes: Fold box 180 + France has no PostNL row and DPD rows with `shipping_cost = 0`. If the engine treats missing shipping_rates rows as "free" (cost = 0) or doesn't filter on `is_available`, it will recommend unavailable box/country combinations as the cheapest option. Workers then can't actually ship the order.

**Why it happens:**
The seed data uses two patterns for "unavailable": (1) no row at all (Fold box 180 + FR via PostNL), and (2) a row with `shipping_cost = 0` and `is_available = false` isn't explicitly modeled in the DPD Fold box 180 data — it just has `is_preferred = false` and `shipping_cost = 0`. These inconsistencies are easy to miss when writing the query.

**How to avoid:**
1. The cost lookup query MUST filter `is_available = true` (or `is_available IS NOT FALSE` depending on default)
2. Treat NULL results (no shipping_rates row for a box/country combination) as "route unavailable" — exclude the packaging from candidates entirely for that country
3. Add a data integrity check: any `shipping_cost = 0` with `is_available != false` should be flagged as suspicious
4. Add a guard in `rankPackagings()`: if `total_cost` resolves to 0 or null for a box, exclude it rather than ranking it as cheapest

**Warning signs:**
- Engine recommends Fold box 180 for French orders
- Boxes with shipping_cost = 0 appear as "cheapest" in engine logs
- Workers report "impossible to ship" for engine-recommended boxes

**Phase to address:**
Phase 1 — Cost data fetching logic. The query and the "no route" handling must be correct before ranking changes.

---

### Pitfall 3: Multi-Box Cost Optimization is Combinatorially Different from Single-Box

**What goes wrong:**
The current greedy multi-box solver (`solveMultiBox`) picks boxes one at a time using `pickBestCoverage()` — it maximizes units covered per box, tie-breaking on specificity/volume/cost. When switching to cost-primary ranking, this greedy approach can produce suboptimal total costs. Example: 2x Surprise box (each EUR 10 total) might be cheaper than 1x Fold box 130 (EUR 18 total) for the same products. But the greedy solver picks the single Fold box 130 first because it covers all units in one box.

**Why it happens:**
The greedy bin-packing algorithm was designed for specificity-first ranking where "fewer boxes = better." With cost-primary ranking, the optimization target changes: you want minimum total cost across ALL boxes, not minimum box count. These are fundamentally different optimization goals.

**How to avoid:**
1. For multi-box scenarios, compare total cost of the greedy single-box solution vs. splitting into multiple smaller (cheaper) boxes
2. Implement a "split comparison": after finding the greedy solution, also try splitting with the top-N cheapest box types and compare total costs
3. Keep the current greedy approach as the structural solver (it handles compartment rule matching correctly), but add a post-processing cost comparison step
4. Document explicitly: the engine finds valid box combinations first, then optimizes cost among valid combinations — not the other way around

**Warning signs:**
- Multi-product orders consistently get more expensive recommendations than manual packing
- Feedback tracking shows `outcome: 'modified'` with `deviationType: 'different_packaging'` specifically on multi-product orders
- Workers split orders into smaller boxes to save on shipping

**Phase to address:**
Phase 2 — Ranking logic changes. After cost data is available but before going live. This is the hardest algorithmic change.

---

### Pitfall 4: Fingerprint-Based Deduplication Ignores Country Changes

**What goes wrong:**
The existing engine uses `shipping_unit_fingerprint` to deduplicate advice — if the same products are in an order, it returns cached advice. But with cost-based ranking, the same products going to different countries should get different box recommendations. Two orders with identical products (same fingerprint) but different countries (NL vs DE) need different advice.

**Why it happens:**
The fingerprint is built from shipping unit names and quantities only (`buildFingerprint()`). It doesn't include country. The deduplication check at line 922-944 of `packagingEngine.ts` will return stale advice calculated for a different country.

**How to avoid:**
1. Include `countryCode` in the fingerprint: `${unitName}:${qty}` becomes `${countryCode}|${unitName}:${qty}`
2. OR: add `country_code` as a separate column to `packaging_advice` table and include it in the deduplication query (`.eq('country_code', countryCode)`)
3. The second approach is cleaner because it allows querying advice history by country

**Warning signs:**
- First order of a product combination gets correct advice, subsequent orders for different countries get the same (wrong) advice
- Advice for international orders shows suspiciously NL-like pricing
- `packaging_advice` table shows no variation in boxes across countries for identical products

**Phase to address:**
Phase 1 — Must be fixed when adding `countryCode` parameter. Cannot be deferred.

---

### Pitfall 5: Cross-Database Query Failure Silently Breaks Engine

**What goes wrong:**
The facturatie Supabase is a separate instance. If the connection fails (env vars missing, network issue, RLS policy blocking), the engine must not crash or silently fall back to material_cost-only ranking. Currently `syncPackagingCosts.ts` throws on connection failure, but the real-time engine path will be different — it needs graceful degradation.

**Why it happens:**
The existing `syncPackagingCosts` is a manual admin action (button click). Connection failures are visible immediately. But the new cost lookup happens inside `rankPackagings()` or a pre-fetch step during `calculateAdvice()`, which runs automatically during packing. A silent failure here means the engine either crashes mid-packing or returns advice without transport costs factored in.

**How to avoid:**
1. Pre-fetch and cache ALL cost data at engine startup / first call (not per-order)
2. If facturatie Supabase is unreachable, fall back to the current ranking (specificity -> volume -> material_cost) with a clear warning flag on the advice result
3. Add a `cost_data_available: boolean` field to `PackagingAdviceResult` so the UI can show "Advies zonder transportkosten" when degraded
4. Log facturatie connection failures prominently — don't swallow errors

**Warning signs:**
- Engine calls take >5 seconds (network timeout to facturatie Supabase)
- `FACTURATIE_SUPABASE_URL` or `FACTURATIE_SUPABASE_ANON_KEY` not set in some environments
- Advice results show identical `total_cost` values across all countries

**Phase to address:**
Phase 1 — Must be built into the cost data fetching layer from day one. Graceful degradation is not a "nice to have."

---

### Pitfall 6: Ranking Change Breaks Existing Behavior Without A/B Comparison

**What goes wrong:**
Switching ranking from specificity-first to cost-first changes recommendations for ALL orders, including domestic NL orders that were already working well. If cost data is slightly wrong (e.g., one box has outdated pricing), the engine will recommend wrong boxes for the majority of orders. There's no way to validate the new ranking is better without comparing outcomes.

**Why it happens:**
The ranking function is a single sort comparator (`rankPackagings()`). Changing it is a one-line change that affects 100% of orders immediately. Unlike the current approach where specificity is a manually curated score (business logic), costs come from external data that can be stale or incorrect.

**How to avoid:**
1. Add a `ranking_mode` flag: `'specificity'` (current) vs `'cost'` (new) — selectable per calculation or globally
2. During rollout, calculate BOTH rankings and log the comparison, but only use the new ranking when explicitly enabled
3. Use the existing `feedbackTracking.ts` outcome data to compare: are workers overriding cost-ranked advice more or less than specificity-ranked advice?
4. Run cost-ranked advice in "shadow mode" for 1-2 weeks before switching: log what it WOULD recommend, compare with what specificity ranking recommends

**Warning signs:**
- Workers suddenly override engine advice much more often after switch
- Feedback tracking `outcome: 'ignored'` rate spikes
- Box types that were rarely recommended now dominate (indicates pricing anomaly)

**Phase to address:**
Phase 3 — Rollout/validation phase. Must be planned from the start but executed after ranking logic is ready.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode handling cost per product | Skip handling cost lookup complexity | Can't adjust per-product handling costs later | MVP only — if handling cost is truly uniform |
| Cache cost data in-memory without invalidation webhook | No need for pub/sub infrastructure | Stale costs for up to 15 min after price update | Always, given costs change monthly not hourly |
| Query facturatie DB per engine call instead of caching | Simpler code, always fresh data | Adds 200-500ms latency per advice calculation, hits facturatie rate limits during batch processing | Never — packing sessions process dozens of picklists sequentially |
| Store transport cost on `packagings` table instead of separate lookup | Reuse existing `material_cost` pattern | Loses country dimension — one row per packaging can't hold 9 country prices | Never — this is the core requirement |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Facturatie Supabase `boxes` table | Assuming `sku` matches `packagings.barcode` 1:1 | Some packagings may not have a barcode, or the barcode format may differ (e.g., `55_926-1` hyphen). Validate mapping completeness on sync. |
| Facturatie `shipping_rates` | Assuming every box has a rate for every country | Not all boxes ship to all countries (Fold box 180 + FR). The engine must handle NULL lookups as "unavailable", not as "free". |
| Facturatie `shipping_rates.is_preferred` | Using `is_preferred = true` as the only filter | For cost optimization, you may want the cheapest carrier, not the preferred one. Clarify: does `is_preferred` mean "use this one" or "default but overridable"? The FACTURATIE_SPEC implies "use this one." |
| Picqer `order.deliverycountry` | Assuming it's always a 2-letter ISO code | Picqer may return full country names or inconsistent casing. The `transform.ts` uses `order.deliverycountry` directly. Normalize to ISO 2-letter uppercase before using as lookup key. |
| Picqer order data during packing | Assuming order data is available on the picklist object | Picklists reference orders via `idorder` but don't include delivery address. A separate Picqer API call is needed: `GET /orders/{idorder}` to get `deliverycountry`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Fetching cost data from facturatie per order | Engine latency >2s, facturatie Supabase rate limits hit | In-memory cache with 10-15 min TTL, pre-fetched on first engine call | Immediately during batch packing (10+ orders in sequence) |
| Re-fetching all Picqer tags on every `applyTags()` call | `getTags()` fetches ALL tags from Picqer each time (line 1155) | Cache Picqer tags in-memory, refresh every 5 min | Already a problem at scale — exacerbated when engine runs more frequently with cost ranking |
| N+1 queries for order country in batch packing | Each picklist triggers a Picqer API call to get order country | Batch-fetch order data for all picklists in a batch session upfront | When a batch has 15+ picklists |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Showing only the recommended box without cost breakdown | Worker doesn't understand WHY a different box is recommended, loses trust | Show: "Fold box 100 (EUR 14.70) vs Fold box 130 (EUR 19.23) — besparing: EUR 4.53" |
| Not explaining unavailable routes | Worker sees "geen advies" for a French order without knowing why | Show: "Fold box 180 niet beschikbaar voor Frankrijk — alternatief: Fold box 160" |
| Changing recommendations without notice | Workers who memorized "plant X always goes in Surprise box" suddenly see different advice | Announce the change, show "Nieuw: kostengeoptimaliseerd advies" badge for first 2 weeks |

## "Looks Done But Isn't" Checklist

- [ ] **Cost lookup:** Missing shipping_rates for a box/country returns `null`, not `0` — verify edge case handling
- [ ] **Multi-box cost:** Total cost of multi-box solution is sum of ALL boxes' (material + transport), not just the first box — verify `solveMultiBox` aggregates correctly
- [ ] **Fingerprint update:** `buildFingerprint()` includes country code — verify deduplication works across countries
- [ ] **Fallback path:** When facturatie is down, engine still returns advice (degraded) — verify with `FACTURATIE_SUPABASE_URL` unset
- [ ] **Handling cost:** Included in total cost calculation — verify not accidentally double-counted (currently in `matchCompartments` as `handling_cost + material_cost`)
- [ ] **Cache invalidation:** After `syncPackagingCosts` runs, in-memory cost cache is cleared — verify stale cache doesn't persist
- [ ] **Country normalization:** `order.deliverycountry` edge cases (empty, null, lowercase, full name) all handled — verify with real Picqer data
- [ ] **Weight validation:** Still works after ranking changes — verify `validateWeightsForBoxes` isn't bypassed

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong country passed to engine | LOW | Fix data threading, recalculate affected advice (fingerprint invalidation handles this automatically) |
| Unavailable routes recommended | MEDIUM | Fix query filter, remove applied tags from affected orders (`removeOrderTag`), recalculate |
| Multi-box suboptimal cost | LOW | Improve solver algorithm, no data migration needed — just recalculate going forward |
| Fingerprint deduplication bug | MEDIUM | Add country to fingerprint, invalidate all existing `packaging_advice` records, recalculate on next engine call |
| Facturatie connection failure | LOW | Add graceful degradation code, no data impact — engine continues with fallback ranking |
| Ranking change causes worse outcomes | MEDIUM | Revert ranking_mode flag to 'specificity', analyze feedback tracking data, fix cost data, re-enable gradually |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Country not passed to engine | Phase 1 (Data Layer) | Engine calculate API accepts and requires `countryCode` parameter |
| Unavailable routes as zero-cost | Phase 1 (Data Layer) | Test: Fold box 180 + FR returns no match, not cheapest |
| Multi-box cost optimization | Phase 2 (Ranking Logic) | Test: 2x small boxes cheaper than 1x large box — engine picks 2x small |
| Fingerprint ignores country | Phase 1 (Data Layer) | Test: Same products, different countries → different advice IDs |
| Cross-DB failure breaks engine | Phase 1 (Data Layer) | Test: Unset FACTURATIE env vars → engine returns degraded advice, not 500 |
| Ranking change without A/B | Phase 3 (Rollout) | Shadow mode logs exist for 1+ week before live switch |

## Sources

- Direct codebase analysis: `src/lib/engine/packagingEngine.ts` (1200 lines, full engine flow)
- Direct codebase analysis: `src/lib/supabase/syncPackagingCosts.ts` (existing cross-DB pattern)
- Direct codebase analysis: `src/lib/supabase/facturatieClient.ts` (facturatie connection setup)
- Direct codebase analysis: `src/lib/engine/feedbackTracking.ts` (outcome measurement)
- Direct codebase analysis: `src/app/api/verpakking/engine/calculate/route.ts` (API contract)
- Direct codebase analysis: `src/lib/picqer/transform.ts` (country field: `deliverycountry`)
- Planning document: `.planning/FACTURATIE_SPEC.md` (complete schema with seed data)
- Planning document: `.planning/PROJECT.md` (requirements and constraints)

---
*Pitfalls research for: cost-optimized packaging advice engine*
*Researched: 2026-02-24*
