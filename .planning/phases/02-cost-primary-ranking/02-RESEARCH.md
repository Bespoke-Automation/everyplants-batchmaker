# Phase 2: Cost-Primary Ranking - Research

**Researched:** 2026-02-24
**Domain:** Sort algorithm modification, cost data enrichment, multi-box cost aggregation
**Confidence:** HIGH

## Summary

Phase 2 transforms the engine's ranking logic from specificity-primary to cost-primary sorting. This is the core algorithmic change that delivers the project's central value proposition: always recommend the cheapest packaging option.

The implementation requires three concrete modifications to `packagingEngine.ts`: (1) add `barcode` to `PackagingMatch` and the packagings query in `matchCompartments()` so the cost provider's SKU-keyed cache can be used for lookup, (2) create an `enrichWithCosts()` function that injects `box_cost`, `transport_cost`, and `total_cost` from the cost provider into each `PackagingMatch` before ranking, and (3) change `rankPackagings()` to sort by `total_cost ASC` as primary criterion with specificity and volume as tiebreakers. Additionally, packagings with no preferred route for the destination country must be filtered out entirely.

The main complexity lies in the multi-box solver: `rankPackagings()` is called in **4 locations** across `calculateAdvice()` and `solveMultiBox()`. Each call must operate on cost-enriched matches. The enrichment step must happen once (centrally in `calculateAdvice()`) and be propagated through to all `rankPackagings()` calls, including the recursive calls inside `solveMultiBox()`'s greedy loop where `matchCompartments()` is called again and produces fresh (unenriched) matches. Each of these fresh matches also needs enrichment before ranking.

No new dependencies are needed. The existing `costProvider.ts` (built in Phase 1) provides all data. This is a pure algorithmic refactor with zero infrastructure changes.

**Primary recommendation:** Add `barcode` to `PackagingMatch` and the packagings query. Create `enrichWithCosts(matches, costMap)` as a pure function. Pass the cost map through `solveMultiBox()` so inner `matchCompartments()` calls can also be enriched. Change `rankPackagings()` sort order. Filter out matches with no route.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.2 | Type safety for enriched `PackagingMatch` fields | Already in use |
| `costProvider.ts` | N/A (local) | `getAllCostsForCountry()` provides `Map<sku, CostEntry>` | Built in Phase 1 |

### Supporting

No new libraries or supporting packages needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mutating `PackagingMatch.total_cost` in-place | Creating new enriched type | Extra type complexity for no real benefit; `PackagingMatch` already has `total_cost` field |
| Passing cost map through function params | Module-level cached cost variable | Function params are explicit and testable; module-level state is harder to reason about |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended File Structure

```
src/lib/engine/
  costProvider.ts       # EXISTS (Phase 1): provides Map<sku, CostEntry>
  packagingEngine.ts    # MODIFIED: enrichWithCosts(), rankPackagings() sort, barcode on PackagingMatch
```

No new files are needed. All changes are within `packagingEngine.ts`.

### Pattern 1: Enrich-Then-Rank Pipeline

**What:** A pure function `enrichWithCosts()` takes an array of `PackagingMatch[]` and a `Map<string, CostEntry>` (from the cost provider), and returns the same array with `box_cost`, `transport_cost`, and `total_cost` fields updated from the cost data. Matches whose barcode has no entry in the cost map are filtered out (no route available).

**When to use:** Between `matchCompartments()` and `rankPackagings()` in every code path.

**Example:**
```typescript
function enrichWithCosts(
  matches: PackagingMatch[],
  costMap: Map<string, CostEntry> | null
): PackagingMatch[] {
  // If no cost data, return matches unchanged (graceful degradation)
  if (!costMap) return matches

  return matches
    .map(match => {
      if (!match.barcode) return match  // no barcode = can't look up cost, keep as-is

      const cost = costMap.get(match.barcode)
      if (!cost) return null  // no route for this country -> exclude

      return {
        ...match,
        box_cost: cost.boxCost,
        transport_cost: cost.transportCost,
        total_cost: cost.boxCost + cost.transportCost,
      }
    })
    .filter((m): m is PackagingMatch => m !== null)
}
```

### Pattern 2: Cost-Primary Sort with Tiebreakers

**What:** `rankPackagings()` changes from `specificity DESC > volume ASC > cost ASC` to `total_cost ASC > specificity DESC > volume ASC`.

**When to use:** When cost data is available. When cost data is NOT available (`costMap === null`), the original sort order should be preserved.

**Example:**
```typescript
export function rankPackagings(
  matches: PackagingMatch[],
  costDataAvailable: boolean = false
): PackagingMatch[] {
  return [...matches].sort((a, b) => {
    if (costDataAvailable) {
      // Cost-primary: cheapest first
      if (a.total_cost !== b.total_cost) {
        return a.total_cost - b.total_cost
      }
      // Tiebreaker 1: specificity DESC (most specific first)
      if (b.specificity_score !== a.specificity_score) {
        return b.specificity_score - a.specificity_score
      }
      // Tiebreaker 2: volume ASC (smallest box first)
      return a.volume - b.volume
    } else {
      // Fallback: original specificity-based ranking
      if (b.specificity_score !== a.specificity_score) {
        return b.specificity_score - a.specificity_score
      }
      if (a.volume !== b.volume) {
        return a.volume - b.volume
      }
      return a.total_cost - b.total_cost
    }
  })
}
```

### Pattern 3: Cost Map Threading Through solveMultiBox

**What:** `solveMultiBox()` calls `matchCompartments()` internally (lines 609 and 671) and then `rankPackagings()`. These fresh matches need cost enrichment. The cost map must be passed through as a parameter.

**When to use:** Always -- `solveMultiBox()` is the primary code path for both single-box and multi-box advice.

**Example:**
```typescript
export async function solveMultiBox(
  shippingUnits: Map<string, ShippingUnitEntry>,
  unclassified: string[],
  allMatches: PackagingMatch[],  // already enriched
  products: OrderProduct[],
  costMap: Map<string, CostEntry> | null,  // NEW param
  costDataAvailable: boolean               // NEW param
): Promise<{ boxes: AdviceBox[]; confidence: 'full_match' | 'partial_match' | 'no_match' }>
```

### Pattern 4: AdviceBox Cost Fields for Multi-Box Aggregation

**What:** `AdviceBox` gains optional cost fields (`box_cost`, `transport_cost`, `total_cost`) populated from the `PackagingMatch` that was selected for each box. The `PackagingAdviceResult` gains a `total_order_cost` field that sums all box costs.

**When to use:** For UI display in Phase 3 and for correct multi-box cost aggregation in Phase 2.

**Example:**
```typescript
export interface AdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number        // NEW
  transport_cost?: number  // NEW
  total_cost?: number      // NEW
}
```

### Anti-Patterns to Avoid

- **Enriching inside rankPackagings:** Keep ranking as a pure sort function. Enrichment is a separate step. Mixing concerns makes testing harder and the data flow opaque.
- **Filtering no-route matches inside rankPackagings:** Ranking should sort, not filter. Filtering happens in `enrichWithCosts()` before ranking is called.
- **Ignoring inner matchCompartments calls:** `solveMultiBox()` calls `matchCompartments()` twice -- once for non-mixable products (line 609) and once per greedy iteration (line 671). Both produce fresh `PackagingMatch[]` without cost data. Both must be enriched before ranking.
- **Passing cost data as module-level state:** The cost map is request-scoped (per country, per engine call). Module-level state would create race conditions between concurrent requests for different countries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cost lookup per packaging | New DB query per match | `costProvider.getAllCostsForCountry()` from Phase 1 | Already built, cached, graceful degradation |
| SKU mapping table | New barcode-to-UUID mapping | Add `barcode` to `PackagingRow` and `PackagingMatch` | The packagings DB table already has `barcode`; just add it to the SELECT |

**Key insight:** Phase 2 is purely an algorithmic change -- modifying sort order and adding an enrichment step. All data infrastructure exists from Phase 1. The only "new" thing is plumbing a field (`barcode`) that already exists in the database but isn't yet selected in the engine query.

## Common Pitfalls

### Pitfall 1: Missing Barcode on PackagingMatch Blocks Cost Lookup

**What goes wrong:** The cost provider cache is keyed by SKU (= `packagings.barcode`). The current `PackagingMatch` interface does not include `barcode`. Without it, `enrichWithCosts()` cannot look up costs for any packaging.

**Why it happens:** The `matchCompartments()` query (line 356) selects `id, idpackaging, name, picqer_tag_name, specificity_score, volume, handling_cost, material_cost, max_weight` from packagings but not `barcode`.

**How to avoid:**
1. Add `barcode: string | null` to `PackagingRow` and `PackagingMatch` interfaces
2. Add `barcode` to the SELECT in `matchCompartments()` (line 356)
3. Populate `match.barcode = pkg.barcode` when building matches (line 409-420)

**Warning signs:** `enrichWithCosts()` returns all matches unchanged because `match.barcode` is always undefined.

### Pitfall 2: Inner matchCompartments Calls in solveMultiBox Produce Unenriched Matches

**What goes wrong:** `solveMultiBox()` calls `matchCompartments()` at line 609 (non-mixable products) and line 671 (greedy multi-box loop). These produce `PackagingMatch[]` with `total_cost` set to `handling_cost + material_cost` (the old formula from line 418). If these are ranked without enrichment, the cost-based sort uses wrong costs.

**Why it happens:** `matchCompartments()` sets `total_cost` from local DB fields, not from the cost provider. Enrichment must happen after every `matchCompartments()` call.

**How to avoid:**
1. Pass `costMap` and `costDataAvailable` into `solveMultiBox()`
2. After every `matchCompartments()` call inside `solveMultiBox()`, call `enrichWithCosts(matches, costMap)`
3. Pass `costDataAvailable` to every `rankPackagings()` call

**Warning signs:** Multi-box advice recommends different packagings than single-box advice for the same products because different cost data was used.

### Pitfall 3: Zero-Cost Matches From Missing Barcode Treated as Cheapest

**What goes wrong:** If a packaging in the database has `barcode = NULL`, `enrichWithCosts()` cannot look up its cost. If the function sets `total_cost = 0` for these, they float to the top of cost-primary ranking as "cheapest."

**Why it happens:** Some packagings might not have barcodes configured yet (newly added boxes).

**How to avoid:** If `match.barcode` is null, keep the match with its original `total_cost` (from `handling_cost + material_cost`). Do NOT set it to 0. Alternatively, if cost data is available, exclude barcode-less matches since they can't be cost-evaluated. The safest approach: when `costDataAvailable = true`, exclude matches without barcode from the results (they can't be properly ranked by cost).

**Warning signs:** "No box" or newly added packagings consistently ranked first.

### Pitfall 4: recalculateMatchesForRemaining Spreads Without Barcode

**What goes wrong:** The `recalculateMatchesForRemaining()` function (line 726-749) creates new match objects via spread (`{ ...match, leftover_units: leftover }`). If `barcode` is added to `PackagingMatch`, the spread will carry it forward. But the function also creates new matches from `allMatches` -- these already have `barcode` from the enrichment step. This is fine. However, cost data needs to be present on these re-spread matches too.

**Why it happens:** The spread preserves all fields from the source match. As long as `allMatches` was enriched before being passed to `solveMultiBox()`, the re-spread matches will have correct costs.

**How to avoid:** Ensure `allMatches` passed to `solveMultiBox()` is already enriched with costs. This is naturally the case if enrichment happens in `calculateAdvice()` before calling `solveMultiBox()`.

**Warning signs:** None expected if the enrichment happens at the right point in the pipeline.

### Pitfall 5: Concurrent Requests for Different Countries Share Wrong Rankings

**What goes wrong:** If `costDataAvailable` is stored as module-level state instead of passed as a parameter, two concurrent requests (one for NL, one for DE) could see each other's cost-availability state.

**Why it happens:** Node.js runs in a single event loop but async operations interleave.

**How to avoid:** Pass `costDataAvailable` and `costMap` as function parameters, never as module-level state. The cost CACHE in `costProvider.ts` is safe (it caches all countries), but the per-request decision of "which country" and "was cost data available" must be per-call.

**Warning signs:** Intermittent ranking differences for the same order; cost_data_available flipping between true/false.

## Code Examples

### Example 1: Complete enrichWithCosts Implementation

```typescript
// Source: packagingEngine.ts (to be added)
import type { CostEntry } from './costProvider'

/**
 * Enrich packaging matches with cost data from the cost provider.
 * Matches without a preferred route for the country are excluded.
 */
function enrichWithCosts(
  matches: PackagingMatch[],
  costMap: Map<string, CostEntry> | null
): PackagingMatch[] {
  if (!costMap) return matches  // No cost data → keep original costs

  return matches
    .map(match => {
      if (!match.barcode) return match  // No barcode → can't look up, keep as-is

      const cost = costMap.get(match.barcode)
      if (!cost) return null  // No preferred route for this country → EXCLUDE

      return {
        ...match,
        box_cost: cost.boxCost,
        transport_cost: cost.transportCost,
        total_cost: cost.boxCost + cost.transportCost,
      }
    })
    .filter((m): m is PackagingMatch => m !== null)
}
```

### Example 2: Modified rankPackagings

```typescript
// Source: packagingEngine.ts line 520 (to be modified)

export function rankPackagings(
  matches: PackagingMatch[],
  costDataAvailable: boolean = false
): PackagingMatch[] {
  return [...matches].sort((a, b) => {
    if (costDataAvailable) {
      // PRIMARY: total_cost ASC (cheapest first)
      if (a.total_cost !== b.total_cost) {
        return a.total_cost - b.total_cost
      }
      // TIEBREAKER 1: specificity_score DESC
      if (b.specificity_score !== a.specificity_score) {
        return b.specificity_score - a.specificity_score
      }
      // TIEBREAKER 2: volume ASC
      return a.volume - b.volume
    }
    // Fallback: original ranking (no cost data)
    if (b.specificity_score !== a.specificity_score) {
      return b.specificity_score - a.specificity_score
    }
    if (a.volume !== b.volume) {
      return a.volume - b.volume
    }
    return a.total_cost - b.total_cost
  })
}
```

### Example 3: Modified calculateAdvice Flow (Steps 2-4)

```typescript
// In calculateAdvice(), after matchCompartments (line 963):

// Step 2: Match compartments
const matches = await matchCompartments(shippingUnits)

// Step 2b: Cost data enrichment
let costDataAvailable = false
let costMap: Map<string, CostEntry> | null = null

if (countryCode) {
  costMap = await getAllCostsForCountry(countryCode)
  costDataAvailable = costMap !== null
  if (!costDataAvailable) {
    console.warn(`[packagingEngine] Cost data unavailable for ${countryCode}, using specificity ranking`)
  }
}

// Step 2c: Enrich matches with cost data + filter unavailable routes
const enrichedMatches = enrichWithCosts(matches, costMap)

// Step 3: Rank (with cost-primary if available)
const ranked = rankPackagings(enrichedMatches, costDataAvailable)

// Step 4: Solve multi-box (pass cost context through)
let { boxes, confidence } = await solveMultiBox(
  shippingUnits, unclassified, ranked, products,
  costMap, costDataAvailable
)
```

### Example 4: AdviceBox with Cost Fields

```typescript
// When creating AdviceBox from a match in solveMultiBox:
boxes.push({
  packaging_id: bestMatch.packaging_id,
  packaging_name: bestMatch.packaging_name,
  idpackaging: bestMatch.idpackaging,
  products: boxProducts,
  box_cost: bestMatch.box_cost,
  transport_cost: bestMatch.transport_cost,
  total_cost: bestMatch.total_cost,
})
```

### Example 5: Modified matchCompartments Query

```typescript
// Line 356: Add barcode to the SELECT
const { data: packagings, error: pkgError } = await supabase
  .schema('batchmaker')
  .from('packagings')
  .select('id, idpackaging, name, barcode, picqer_tag_name, specificity_score, volume, handling_cost, material_cost, max_weight')
  .eq('active', true)
  .eq('use_in_auto_advice', true)

// Line 409-420: Add barcode to the PackagingMatch construction
matches.push({
  packaging_id: pkg.id,
  packaging_name: pkg.picqer_tag_name || pkg.name,
  idpackaging: pkg.idpackaging,
  barcode: pkg.barcode ?? null,  // NEW
  rule_group: groupNum,
  covered_units: matchResult.covered,
  leftover_units: matchResult.leftover,
  specificity_score: pkg.specificity_score ?? 50,
  volume: pkg.volume ?? Infinity,
  total_cost: (pkg.handling_cost ?? 0) + (pkg.material_cost ?? 0),
  max_weight: pkg.max_weight ?? Infinity,
})
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `rankPackagings()`: specificity DESC > volume ASC > cost ASC | Phase 2 changes to: cost ASC > specificity DESC > volume ASC | This phase | Core value delivery |
| `PackagingMatch.total_cost` = handling + material (local DB) | Will be overwritten by costProvider data (box + transport per country) | This phase | Country-specific cost ranking |
| No route filtering | Packagings without preferred route for country are excluded | This phase | Prevents impossible recommendations |
| `solveMultiBox` ignores costs | Cost map threaded through for correct inner rankings | This phase | Multi-box advice uses same cost data |

**Deprecated/outdated:**
- The `total_cost` field on `PackagingMatch` currently reflects `handling_cost + material_cost` from the local `packagings` table. After Phase 2, when cost data is available, this field is overwritten with the true total cost (box material + transport) from the facturatie database. When cost data is NOT available, the old formula persists as fallback.

## Open Questions

1. **Should packagings without barcode be excluded when cost data is available?**
   - What we know: The cost provider is keyed by SKU (= barcode). Packagings without barcode cannot be cost-evaluated.
   - What's unclear: Are there active packagings with `use_in_auto_advice = true` that have no barcode?
   - Recommendation: Keep barcode-less matches with their original `total_cost` (from local DB). They will sort after properly costed matches because their `total_cost` is lower (no transport included). This is acceptable behavior -- they are "unknown cost" rather than "cheapest." If this proves problematic, we can exclude them in a follow-up.

2. **Should `AdviceBox` cost fields be persisted to `packaging_advice.advice_boxes` JSON?**
   - What we know: `advice_boxes` is stored as JSON in the `packaging_advice` table. Adding cost fields to `AdviceBox` will automatically persist them.
   - What's unclear: Whether Phase 3 UI will read costs from the stored advice JSON or recalculate.
   - Recommendation: Persist cost fields. This is free (JSON expansion) and gives Phase 3 the data it needs without re-querying the cost provider.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ENG-01 | `rankPackagings()` sorts primarily on `total_cost ASC` (box + transport costs); specificity and volume as tiebreakers; multi-box solver aggregates costs correctly | `enrichWithCosts()` injects cost provider data into `PackagingMatch.total_cost` before ranking. `rankPackagings()` gains `costDataAvailable` param to switch sort order. `solveMultiBox()` receives `costMap` to enrich inner `matchCompartments()` results. `AdviceBox` gains cost fields for per-box cost tracking in multi-box solutions. |
</phase_requirements>

## Key Implementation Details

### The 4 Call Sites of rankPackagings

All 4 must receive enriched matches and the `costDataAvailable` flag:

| Location | Line | Context | Enrichment Strategy |
|----------|------|---------|---------------------|
| `calculateAdvice()` | 978 | Main ranking of all matches | Enrich before this call; matches come from `matchCompartments()` at line 963 |
| `solveMultiBox()` non-mixable | 610 | Ranking for individual non-mixable product boxes | `matchCompartments()` called at line 609; must enrich result before ranking |
| `solveMultiBox()` mixable single-box | 643 | Ranking re-calculated matches for mixable products | Uses `recalculateMatchesForRemaining()` or `matchCompartments()`; enriched if source `allMatches` was enriched |
| `solveMultiBox()` greedy loop | 672 | Each iteration of multi-box splitting | `matchCompartments()` called at line 671; must enrich result before ranking |

### The Join Key Problem (barcode)

- **Cost provider cache key:** `Map<string, CostEntry>` keyed by `packaging_costs.sku` (e.g., `'55_949'`)
- **Batchmaker field:** `packagings.barcode` column (same format, e.g., `'55_949'`)
- **Current gap:** `PackagingMatch` does not include `barcode`; `matchCompartments()` does not SELECT `barcode`
- **Fix:** Add `barcode` to `PackagingRow` interface, `PackagingMatch` interface, the SQL SELECT, and the match construction

### PackagingMatch Interface Extension

Current fields that Phase 2 adds/modifies:

```typescript
export interface PackagingMatch {
  // existing fields...
  barcode: string | null      // NEW: from packagings.barcode, used as cost lookup key
  box_cost: number            // NEW: from CostEntry.boxCost (0 if not enriched)
  transport_cost: number      // NEW: from CostEntry.transportCost (0 if not enriched)
  total_cost: number          // EXISTING: value overwritten by enrichment
  // existing fields continue...
}
```

### Graceful Degradation Preserved

When `costDataAvailable === false`:
- `enrichWithCosts()` returns matches unchanged (no filtering)
- `rankPackagings()` uses original sort order (specificity > volume > cost)
- `total_cost` remains `handling_cost + material_cost` (from local DB)
- No behavioral change compared to current production behavior

### Multi-Box Cost Aggregation

For success criterion 3 (multi-box cost aggregation):
- Each `AdviceBox` gets `box_cost`, `transport_cost`, `total_cost` from its selected `PackagingMatch`
- `PackagingAdviceResult` does not need a `total_order_cost` field in Phase 2 -- Phase 3 can sum `advice_boxes[].total_cost` in the UI
- The aggregation is correct because each box's cost comes from the same cost provider data (same country, same cache)

### Route Exclusion Implementation

For success criterion 4 (exclude boxes without preferred route):
- `enrichWithCosts()` returns `null` for matches whose barcode has no entry in `costMap`
- The `.filter()` removes these null entries
- A match with no route simply disappears from the candidate list
- If ALL matches are excluded (no box can ship to this country), the engine returns `confidence: 'no_match'`
- Example: Fold box 180 + FR = no PostNL row (PostNL is preferred for FR on this box size) = excluded for French orders

## Sources

### Primary (HIGH confidence)
- `src/lib/engine/packagingEngine.ts` -- Full engine with all 4 `rankPackagings()` call sites, `matchCompartments()` query (line 356), `solveMultiBox()` inner calls, `PackagingMatch` interface
- `src/lib/engine/costProvider.ts` -- Phase 1 output: `getAllCostsForCountry()` returns `Map<string, CostEntry>` keyed by SKU
- `src/types/verpakking.ts` -- `CostEntry` interface with `boxSku`, `boxCost`, `transportCost`, `totalCost`
- `src/lib/supabase/syncPackagingCosts.ts` -- Validates `packagings.barcode` = `packaging_costs.sku` join key pattern
- `.planning/FACTURATIE_SPEC.md` -- Seed data confirming SKU format and preferred carrier assignments

### Secondary (MEDIUM confidence)
- `.planning/phases/01-cost-data-layer/01-01-SUMMARY.md` -- Phase 1 deliverables: costProvider.ts, CostEntry type
- `.planning/phases/01-cost-data-layer/01-02-SUMMARY.md` -- Country threading: countryCode on calculateAdvice, cost_data_available flag
- `.planning/REQUIREMENTS.md` -- ENG-01 acceptance criteria

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- No new dependencies; all code changes are within existing `packagingEngine.ts`
- Architecture: HIGH -- Enrichment pattern is standard transform-then-sort; all call sites identified from direct code reading
- Pitfalls: HIGH -- All 5 pitfalls identified from line-by-line analysis of `matchCompartments()`, `solveMultiBox()`, and `rankPackagings()`

**Research date:** 2026-02-24
**Valid until:** 2026-03-24 (stable domain, no moving parts)
