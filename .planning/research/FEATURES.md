# Feature Research

**Domain:** Packaging cost optimization for warehouse operations (internal tool)
**Researched:** 2026-02-24
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features the warehouse team and management assume exist. Missing these = the cost optimization is unreliable or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Cost-based ranking as primary sort | Core value proposition. Current ranking is specificity -> volume -> cost. Must flip to cost-primary while respecting compartment rule constraints. | LOW | `rankPackagings()` is 12 lines. Change sort order to: total_cost ASC -> specificity DESC -> volume ASC. Minimal code change, high business impact. |
| Total cost = material + transport + handling | Without all 3 cost layers, the "cheapest" recommendation is wrong. A cheap box with expensive shipping is not cheap. | MEDIUM | Material cost already synced from facturatie (`syncPackagingCosts.ts`). Transport costs need new data source. Handling cost field exists on `packagings` table but is manual. |
| Destination country awareness | Transport costs vary dramatically by country (NL vs DE vs FR). Engine must know where the order ships to. | LOW | `deliveryaddress.country` already available on Picqer orders. Already exposed in `DeliveryAddress.countryCode` type. Just needs to be passed into `calculateAdvice()`. |
| Carrier-per-box-per-country lookup | Each box/country combination has a fixed carrier (PostNL or DPD). Transport cost depends on this mapping. | MEDIUM | Currently in Excel. Needs to be stored as configuration (Supabase table or facturatie query). ~20-30 box/country combinations. |
| Transport cost lookup from facturatie | Transport tariffs exist in the facturatie Supabase. Engine must read them to calculate total cost. | MEDIUM | `facturatieClient.ts` already exists. `syncPackagingCosts.ts` shows the pattern. Need to discover the transport tariff table schema and build a similar reader. |
| In-memory cost cache (10-15 min TTL) | Engine runs during real-time packing. Querying facturatie Supabase per advice request adds latency. Costs change at most daily. | LOW | Standard pattern: module-level `Map` + timestamp check. Same approach as Picqer's 30s order cache in `client.ts`. |
| Fallback when cost data missing | If a box has no transport cost for a country, the engine must not crash or silently pick an expensive option. | LOW | Use current ranking (specificity -> volume) as fallback when cost data is incomplete. Log a warning. Set confidence to `partial_match` if cost data was unavailable for any candidate. |
| Single-product order support | PROJECT.md lists this as active requirement. Many orders have 1 product — engine must handle these correctly. | LOW | Engine already handles any product count via `classifyOrderProducts()` -> `matchCompartments()` -> `solveMultiBox()`. The non-mixable solo-box path already works. Likely just needs testing/validation, not new code. |

### Differentiators (Competitive Advantage)

Features that improve the system beyond basic cost optimization. Not required for launch, but add measurable value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cost breakdown visibility in UI | Warehouse manager can see WHY a box was recommended: material + transport + handling breakdown per box. Builds trust in the engine. | LOW | `PackagingMatch` already has `total_cost`. Extend `AdviceBox` type with `cost_breakdown: { material: number; transport: number; handling: number; total: number }`. Display in `VerpakkingsClient.tsx` next to box suggestion. |
| Multi-box cost optimization | When splitting into multiple boxes, minimize TOTAL cost across all boxes, not just pick cheapest per-box greedily. | HIGH | Current `solveMultiBox()` uses greedy approach. True optimization is NP-hard (bin-packing variant). For EveryPlants' scale (~5-10 box types, ~1-5 boxes per order), exhaustive search of combinations is feasible. Defer unless greedy produces visibly wrong results. |
| Cost savings dashboard | Track actual cost savings vs old specificity-based ranking. Show: "Engine saved X euro this week/month." | MEDIUM | Requires storing `total_cost` on `packaging_advice` records. Compare with hypothetical cost of specificity-ranked first choice. `feedbackTracking.ts` already records outcomes — extend with cost delta. |
| Automatic cost sync schedule | Periodically refresh material costs from facturatie instead of manual admin trigger. | LOW | Inngest is already in the stack. Add a cron function that calls `syncPackagingCosts()` + new transport cost sync daily. Currently triggered manually via `/api/admin/sync-packaging-costs`. |
| Country-specific carrier override UI | Let ops team change carrier-box-country mappings without code changes. | MEDIUM | If stored in Supabase, a simple CRUD UI in `/verpakkingsmodule/instellingen` follows existing patterns (`PackagingList.tsx`, `CompartmentRules.tsx`). |
| Weight-based transport cost tiers | Some carriers charge by weight tier, not flat per box. Accounting for this gives more accurate cost estimates. | MEDIUM | Weight validation already exists (`validateWeightsForBoxes()`). Could extend transport lookup with weight tiers. Adds accuracy but adds complexity to the cost lookup. Only build if flat-rate-per-box proves inaccurate. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in this context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Real-time carrier API integration | "Get live rates from PostNL/DPD APIs" | Adds latency (200-500ms per request), requires carrier API credentials, rates change at most monthly. Transport contracts are fixed-term. Engine needs sub-100ms response. | Cached tariff table from facturatie. Sync daily or on-demand. |
| Dynamic carrier selection per order | "Let the engine pick the best carrier dynamically" | Carrier per box/country is contractually fixed. PostNL handles small NL parcels, DPD handles larger/international. Changing this requires business negotiation, not software. | Static carrier-box-country mapping as configuration table. |
| Margin/profit calculation | "Show profit margin per packaging choice" | Selling prices, customer contracts, and margin rules are facturatie-domain. Mixing cost optimization with pricing creates coupling and scope creep. | Keep engine focused on COST minimization. Facturatie app handles margins separately. |
| A/B testing of ranking strategies | "Compare cost-based vs specificity-based ranking" | Small warehouse team (< 10 people), low order volume for statistical significance. Adds complexity without actionable data. | Use `feedbackTracking.ts` to monitor deviation rates. If workers consistently override cost-optimized suggestions, investigate manually. |
| Handling cost per product type | "Different handling cost for fragile vs standard" | Handling cost differences between product types are marginal (seconds of labor). Adds configuration burden for minimal cost accuracy gain. | Flat handling cost per box type (already exists as `handling_cost` on `packagings` table). |
| Multi-carrier per shipment | "Split one order across PostNL and DPD" | Creates two tracking numbers, confuses customers, complicates returns. No business case for EveryPlants' order sizes. | One carrier per order (determined by the most restrictive/largest box). |

## Feature Dependencies

```
[Destination country awareness]
    |
    v
[Carrier-per-box-per-country lookup]
    |
    v
[Transport cost lookup from facturatie]
    |
    v
[In-memory cost cache]
    |
    v
[Cost-based ranking as primary sort]  <-- requires all cost data available
    |
    +---enhances---> [Cost breakdown visibility in UI]
    +---enhances---> [Cost savings dashboard]
    +---enhances---> [Multi-box cost optimization]

[Fallback when cost data missing]  -- independent, build alongside ranking change

[Single-product order support]  -- independent, existing engine handles it

[Automatic cost sync schedule]  -- independent, enhances data freshness
    |
    v
[Material cost sync]  (already exists: syncPackagingCosts.ts)
[Transport cost sync]  (new, same pattern)
```

### Dependency Notes

- **Cost-based ranking requires transport cost lookup:** Without transport costs, ranking on cost is only partial (material + handling). Transport is often the largest cost component.
- **Transport cost lookup requires carrier mapping:** Cannot look up transport price without knowing which carrier handles a given box/country pair.
- **Carrier mapping requires destination country:** Without knowing the country, cannot determine the carrier.
- **Cost breakdown enhances ranking:** Only possible after all cost components are calculated. Not a blocker but adds transparency.
- **Fallback is independent:** Should be built in parallel with the ranking change to handle edge cases from day one.

## MVP Definition

### Launch With (v1)

Minimum to deliver cost-optimized packaging advice.

- [ ] **Destination country passed to engine** -- 1 parameter addition to `calculateAdvice()`, country from Picqer order data
- [ ] **Carrier-box-country mapping table** -- Supabase table seeded from current Excel, ~30 rows
- [ ] **Transport cost reader from facturatie** -- Query facturatie Supabase for tariffs, following `syncPackagingCosts.ts` pattern
- [ ] **In-memory cost cache** -- Module-level cache with 10-15 min TTL for both material and transport costs
- [ ] **Cost-based ranking** -- Change `rankPackagings()` sort order to total_cost ASC primary
- [ ] **Fallback behavior** -- When cost data unavailable, fall back to current specificity ranking with logged warning
- [ ] **Single-product order validation** -- Verify engine handles 1-product orders correctly (likely works already)

### Add After Validation (v1.x)

Features to add once cost-based ranking is working and trusted.

- [ ] **Cost breakdown in UI** -- Show material/transport/handling split per advised box. Trigger: workers asking "why this box?"
- [ ] **Automatic daily cost sync** -- Inngest cron for material + transport costs. Trigger: manual sync becoming a forgotten chore
- [ ] **Country-specific carrier override UI** -- CRUD in instellingen. Trigger: carrier mappings changing more than once per quarter
- [ ] **Cost savings tracking** -- Store cost on advice records, compare with previous ranking method. Trigger: management asking "how much does this save?"

### Future Consideration (v2+)

Features to defer until v1 is proven.

- [ ] **Multi-box cost optimization (non-greedy)** -- Only if greedy solver produces observably suboptimal multi-box splits
- [ ] **Weight-based transport tiers** -- Only if flat-rate-per-box proves inaccurate for cost comparison
- [ ] **Cost trend analytics** -- Historical cost tracking, seasonal patterns. Only if data volume warrants it

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Cost-based ranking | HIGH | LOW | P1 |
| Destination country awareness | HIGH | LOW | P1 |
| Transport cost from facturatie | HIGH | MEDIUM | P1 |
| Carrier-box-country mapping | HIGH | MEDIUM | P1 |
| In-memory cost cache | HIGH | LOW | P1 |
| Fallback when costs missing | HIGH | LOW | P1 |
| Single-product order support | MEDIUM | LOW | P1 |
| Cost breakdown in UI | MEDIUM | LOW | P2 |
| Automatic cost sync | MEDIUM | LOW | P2 |
| Carrier override UI | LOW | MEDIUM | P2 |
| Cost savings dashboard | MEDIUM | MEDIUM | P3 |
| Multi-box cost optimization | LOW | HIGH | P3 |
| Weight-based transport tiers | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (cost optimization is unreliable without these)
- P2: Should have, add when core is stable
- P3: Nice to have, defer until proven need

## Existing Infrastructure Analysis

Key findings from codebase exploration that inform feature decisions:

| What Exists | Where | Implication |
|-------------|-------|-------------|
| `material_cost` field on packagings | `packagings` table, synced via `syncPackagingCosts.ts` | Material cost infrastructure is complete. No new work needed. |
| `handling_cost` field on packagings | `packagings` table, editable in UI | Handling cost infrastructure is complete. Currently manual entry. |
| Facturatie Supabase client | `src/lib/supabase/facturatieClient.ts` | Connection to cost data source exists. Just need transport tariff queries. |
| `rankPackagings()` function | `src/lib/engine/packagingEngine.ts:518-531` | 12-line function. Sort order change is trivial. |
| `PackagingMatch.total_cost` | Engine types | Already calculated as `handling_cost + material_cost`. Extend to include transport. |
| `deliveryaddress.country` on orders | Picqer order data, `DeliveryAddress` type | Country data available. Needs to be threaded through to engine. |
| Feedback tracking | `src/lib/engine/feedbackTracking.ts` | Outcome tracking exists. Can extend with cost comparison data later. |
| `PackagingRow` with cost fields | Engine internal types | Already reads `handling_cost`, `material_cost` from DB. Add transport cost. |

## Sources

- Codebase analysis: `src/lib/engine/packagingEngine.ts` (1200 lines, full engine implementation)
- Codebase analysis: `src/lib/supabase/syncPackagingCosts.ts` (existing cost sync pattern)
- Codebase analysis: `src/lib/supabase/facturatieClient.ts` (facturatie connection)
- Codebase analysis: `src/lib/engine/feedbackTracking.ts` (outcome tracking)
- Codebase analysis: `src/types/verpakking.ts` (type definitions including DeliveryAddress)
- Project context: `.planning/PROJECT.md` (requirements, constraints, carrier descriptions)

---
*Feature research for: Packaging cost optimization - EveryPlants Batchmaker*
*Researched: 2026-02-24*
