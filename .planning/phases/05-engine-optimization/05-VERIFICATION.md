---
phase: 05-engine-optimization
verified: 2026-02-26T17:00:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 5: Engine Optimization Verification Report

**Phase Goal:** De engine bepaalt de kostenoptimale verpakkingsoplossing door verbeterde ranking met pick/pack kosten en weight brackets, een niet-greedy multi-box solver, en een directe product-verpakking mapping voor single-SKU orders
**Verified:** 2026-02-26T17:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | rankPackagings sorts by total_cost ASC where total_cost = box_material + pick + pack + transport | VERIFIED | `packagingEngine.ts` line 646-648: `if (a.total_cost !== b.total_cost) return a.total_cost - b.total_cost`. Comment at line 549 explicitly documents `total_cost is set from entry.totalCost directly (NOT box_cost + transport_cost, which would miss pick/pack)` |
| 2  | Boxes without preferred route for destination country are excluded by enrichWithCosts | VERIFIED | `packagingEngine.ts` line 562: `if (!entries || entries.length === 0) return null` followed by `.filter((m): m is PackagingMatch => m !== null)` at line 575 |
| 3  | Equal-cost boxes fall back to specificity DESC then volume ASC tiebreakers | VERIFIED | `packagingEngine.ts` lines 650-655: `TIEBREAKER 1: specificity_score DESC`, `TIEBREAKER 2: volume ASC` |
| 4  | Multi-box solver evaluates multiple packaging combinations to find lowest total cost | VERIFIED | `solveMultiBoxOptimal` function at line 691 implements full branch-and-bound search evaluating all candidate combinations |
| 5  | Multi-box solver has 200ms timeout with fallback to existing greedy algorithm | VERIFIED | Line 1041: `200 // 200ms timeout` passed to `solveMultiBoxOptimal`. Line 1067-1079: greedy fallback when `!multiBoxSolved`. Log message at 1068: `"Multi-box: falling back to greedy solver"` |
| 6  | Each product (SKU) can have a default_packaging_id stored in product_attributes | VERIFIED | Migration `20260226163755_add_default_packaging_to_product_attributes.sql` adds `default_packaging_id UUID REFERENCES batchmaker.packagings(id) ON DELETE SET NULL DEFAULT NULL`. Functions `updateDefaultPackaging()` and `getProductsWithDefaultPackaging()` exist in `productAttributes.ts` |
| 7  | Admin can set/clear the default packaging for any classified product via the UI | VERIFIED | `ProductStatus.tsx` shows "Standaard verpakking" dropdown for classified products (line 280). Handler at line 101 calls `PUT /api/verpakking/product-attributes/default-packaging` with optimistic local state update and per-row loading spinner |
| 8  | Orders with 1 unique SKU use the product's default_packaging_id when set — engine bypassed | VERIFIED | `calculateAdvice` Step 1e (line 1349-1481): checks `uniqueProductIds.size === 1 && unclassified.length === 0`, queries `default_packaging_id`, returns early if found and active — skipping `matchCompartments/rankPackagings/solveMultiBox` entirely |
| 9  | Single-SKU fast path enriches cost data and falls through gracefully on any failure | VERIFIED | Cost enrichment via `selectCostForWeight` at line 1403. Inactive packaging check at line 1371 (`defaultPkg.active`). DB error fallthrough at line 1457-1459: `Fall through to normal engine flow` |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/supabase/productAttributes.ts` | updateDefaultPackaging + getProductsWithDefaultPackaging functions | VERIFIED | Both functions present at lines 427-473. `updateDefaultPackaging` updates `default_packaging_id` via Supabase. Properly handles null to clear. |
| `src/app/api/verpakking/product-attributes/default-packaging/route.ts` | PUT endpoint for setting default packaging | VERIFIED | 40-line file. Has `export const dynamic = 'force-dynamic'`. Validates `productAttributeId` (required) and `packagingId` (string or null). Calls `updateDefaultPackaging()`. Returns `{ success: true }` or error. |
| `src/components/verpakking/ProductStatus.tsx` | Admin UI for default packaging management | VERIFIED | Has `ClassifiedProduct` interface with `default_packaging_id`. Fetches packagings on mount. Renders dropdown per classified product. `savingIds` Set tracks per-row loading state. |
| `src/lib/engine/packagingEngine.ts` (ranking) | enrichWithCosts with full cost formula, rankPackagings with cost-primary sort | VERIFIED | `enrichWithCosts` (line 551) uses `entry.totalCost` for `total_cost`. `rankPackagings` (line 640) sorts by `total_cost ASC` when `costDataAvailable`. JSDoc comment explicitly documents the formula. |
| `src/lib/engine/packagingEngine.ts` (solver) | solveMultiBoxOptimal with branch-and-bound, solveMultiBoxGreedy as fallback | VERIFIED | `solveMultiBoxOptimal` at line 691: 200ms timeout, depth-5 limit, pruning by best-so-far cost, candidate deduplication. `solveMultiBoxGreedy` at line 810: extracted from original greedy code. Integration at lines 1032-1079. |
| `src/lib/engine/packagingEngine.ts` (single-SKU) | Single-SKU fast path in calculateAdvice before matchCompartments | VERIFIED | Step 1e at line 1349. Position confirmed: after fingerprint check (Step 1c), before `matchCompartments` call (Step 2 at line 1484). |
| `supabase/migrations/20260226163755_add_default_packaging_to_product_attributes.sql` | Migration file for default_packaging_id column | VERIFIED | File exists with correct `ALTER TABLE batchmaker.product_attributes ADD COLUMN default_packaging_id UUID REFERENCES batchmaker.packagings(id) ON DELETE SET NULL DEFAULT NULL` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `ProductStatus.tsx` | `/api/verpakking/product-attributes/default-packaging` | fetch PUT | WIRED | Line 105: `fetch('/api/verpakking/product-attributes/default-packaging', { method: 'PUT', ... })` with JSON body `{ productAttributeId, packagingId }` |
| `default-packaging/route.ts` | `productAttributes.ts` | `updateDefaultPackaging()` | WIRED | Import at line 2: `import { updateDefaultPackaging } from '@/lib/supabase/productAttributes'`. Called at line 30. |
| `packagingEngine.ts enrichWithCosts` | `costProvider.ts` | `CostEntry.totalCost` | WIRED | `total_cost: entry.totalCost` at line 572. Import of `CostEntry` type at line 16. Comment documents the full formula. |
| `packagingEngine.ts solveMultiBox` | `solveMultiBoxOptimal` | Direct call at line 1037 | WIRED | `const optimalSolution = solveMultiBoxOptimal(pool, enrichedPool, costDataAvailable, 200)` |
| `packagingEngine.ts calculateAdvice` | `product_attributes.default_packaging_id` | Supabase query at Step 1e | WIRED | Lines 1355-1360: `.select('default_packaging_id, shipping_unit_id').eq('picqer_product_id', productId).single()` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RANK-01 | 05-02 | Engine rankt op totale kosten (laagste eerst) | SATISFIED | `rankPackagings` line 646-648: primary sort `total_cost ASC` when `costDataAvailable` |
| RANK-02 | 05-02 | total_cost = box_material + pick + pack + transport | SATISFIED | `enrichWithCosts` uses `entry.totalCost` from `published_box_costs` which pre-calculates full sum. JSDoc at line 546-549 documents this explicitly. |
| RANK-03 | 05-02 | Dozen zonder preferred route worden uitgesloten | SATISFIED | `enrichWithCosts` line 562: returns `null` for SKUs with no cost entries; `.filter(...null)` removes them |
| RANK-04 | 05-02 | Gelijke kosten: sorteer op specificiteit dan volume | SATISFIED | Lines 650-655: `specificity_score DESC` then `volume ASC` as documented tiebreakers |
| MULTI-01 | 05-02 | Multi-box evalueert combinaties op totaalkosten | SATISFIED | `solveMultiBoxOptimal` explores all candidate combinations with cost-based pruning |
| MULTI-02 | 05-02 | 200ms timeout met greedy fallback | SATISFIED | `timeoutMs = 200` at line 695/1041. Greedy fallback path at lines 1067-1079. |
| SINGLE-01 | 05-01 | Per product kan standaard verpakking vastgelegd worden | SATISFIED | `default_packaging_id` column on `product_attributes`, admin UI in `ProductStatus.tsx`, PUT endpoint |
| SINGLE-02 | 05-03 | 1 uniek SKU gebruikt directe product→verpakking mapping | SATISFIED | Step 1e in `calculateAdvice` detects `uniqueProductIds.size === 1` and uses `default_packaging_id` |
| SINGLE-03 | 05-03 | Single-SKU mapping heeft prioriteit boven compartment rules | SATISFIED | Fast path returns before `matchCompartments` is called (line 1484). Comment at line 1481 confirms: "End of single-SKU fast path — continues to normal matchCompartments flow" |

No orphaned requirements found. All 9 requirements for Phase 5 are covered by the 3 plans. REQUIREMENTS.md traceability table maps RANK-01..04, MULTI-01..02, SINGLE-01..03 to Phase 5 — consistent with plan frontmatter.

### Anti-Patterns Found

None. No TODO/FIXME/placeholder comments found in modified files. No stub implementations (all functions have substantive bodies). No empty return values in new code.

### Human Verification Required

#### 1. Admin UI: Default Packaging Dropdown Behavior

**Test:** Navigate to `/verpakkingsmodule/instellingen`, go to the product status tab. Verify the "Geclassificeerde Producten" section appears with a "Standaard verpakking" dropdown per classified product.
**Expected:** Dropdown shows all active packagings plus "Geen standaard" as empty option. Selecting a packaging shows a spinner during save and persists after page refresh.
**Why human:** Requires a live database with classified products and active packagings. Cannot verify dropdown population programmatically without running the server.

#### 2. Single-SKU Fast Path: End-to-End Engine Trigger

**Test:** Set a default packaging for a product via the admin UI. Trigger the engine for an order containing only that product. Verify the advice returned uses the configured default packaging (not compartment rules).
**Expected:** Engine log shows `[packagingEngine] Single-SKU fast path: product {code} -> {packaging_name}`. Advice box has the mapped packaging. `confidence: 'full_match'`.
**Why human:** Requires a live Picqer order and Supabase data. Cannot trigger `calculateAdvice` with real data in a static code check.

#### 3. Multi-Box Optimal Solver: Timeout Fallback Behavior

**Test:** With cost data available, trigger the engine for a complex order requiring 3+ boxes where compartment rules produce many candidates. Check logs for whether optimal or greedy solver was used.
**Expected:** If solved within 200ms: logs `[packagingEngine] Optimal multi-box: N boxes, total EUR X`. If timed out: logs `[packagingEngine] Multi-box: falling back to greedy solver`.
**Why human:** Requires production-scale order data to stress-test the solver timing. Static analysis confirms the timeout mechanism exists but can't test its behavior under load.

## Summary

Phase 5 goal is fully achieved. All 9 observable truths are verified directly in the codebase:

**Ranking (RANK-01..04):** `enrichWithCosts` correctly uses `entry.totalCost` from `published_box_costs` (which includes box_material + pick + pack + transport). Boxes with no preferred route for the destination country are excluded by returning `null` in the map. `rankPackagings` sorts by `total_cost ASC` as primary key when cost data is available, with specificity DESC and volume ASC as documented tiebreakers.

**Multi-box optimization (MULTI-01..02):** `solveMultiBoxOptimal` implements a proper bounded branch-and-bound search with 200ms timeout, depth-5 limit, and best-so-far pruning. Candidates are deduplicated by `packaging_id:rule_group`. The existing greedy algorithm is preserved as `solveMultiBoxGreedy` and activates automatically on timeout or when cost data is unavailable.

**Single-SKU fast path (SINGLE-01..03):** The `default_packaging_id` column exists on `product_attributes` with a proper FK to `packagings`. Admin UI in `ProductStatus.tsx` provides a dropdown per classified product with per-row save state. Step 1e in `calculateAdvice` detects single-SKU orders and returns early before `matchCompartments` — the engine is bypassed entirely. Cost enrichment via `selectCostForWeight` still runs on the fast path. Graceful fallthrough on inactive packaging, missing mapping, or DB error.

TypeScript compiles cleanly (`npx tsc --noEmit` exits 0). All 5 commits from the summaries are verified in git history. No anti-patterns found.

---

_Verified: 2026-02-26T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
