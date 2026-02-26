---
phase: 05-engine-optimization
plan: 01
subsystem: database, api, ui
tags: [supabase, product-attributes, default-packaging, single-sku, admin-ui]

# Dependency graph
requires: []
provides:
  - "default_packaging_id column on product_attributes table"
  - "updateDefaultPackaging() and getProductsWithDefaultPackaging() Supabase helpers"
  - "PUT /api/verpakking/product-attributes/default-packaging endpoint"
  - "Admin UI for managing product-to-packaging mappings in ProductStatus component"
affects: [05-engine-optimization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row save with loading spinner in admin tables"
    - "Classified products section in ProductStatus with dropdown selectors"

key-files:
  created:
    - "supabase/migrations/20260226163755_add_default_packaging_to_product_attributes.sql"
    - "src/app/api/verpakking/product-attributes/default-packaging/route.ts"
  modified:
    - "src/lib/supabase/productAttributes.ts"
    - "src/app/api/verpakking/products/status/route.ts"
    - "src/components/verpakking/ProductStatus.tsx"

key-decisions:
  - "Classified products fetched inline in products/status API (not separate endpoint) to keep single data load"
  - "Default packaging dropdown only shown for classified products"

patterns-established:
  - "Per-row optimistic update pattern: savingIds Set tracks which rows are saving"

requirements-completed: [SINGLE-01]

# Metrics
duration: 3min
completed: 2026-02-26
---

# Phase 5 Plan 1: Default Product Packaging Summary

**Default packaging data layer with admin UI for single-SKU order packaging bypass configuration**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-26T15:37:18Z
- **Completed:** 2026-02-26T15:40:53Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `default_packaging_id` UUID column to `product_attributes` with FK to `packagings` (ON DELETE SET NULL)
- Created API endpoint for setting/clearing default packaging per product
- Added "Standaard verpakking" dropdown to ProductStatus admin page showing all active packagings
- Per-row loading state during save with optimistic local state update

## Task Commits

Each task was committed atomically:

1. **Task 1: Add default_packaging_id column and Supabase helper** - `360db00` (feat)
2. **Task 2: Add API endpoint and admin UI for default packaging management** - `7ed5041` (feat)

## Files Created/Modified
- `supabase/migrations/20260226163755_add_default_packaging_to_product_attributes.sql` - Migration adding default_packaging_id column
- `src/lib/supabase/productAttributes.ts` - Added updateDefaultPackaging() and getProductsWithDefaultPackaging() functions
- `src/app/api/verpakking/product-attributes/default-packaging/route.ts` - PUT endpoint for default packaging CRUD
- `src/app/api/verpakking/products/status/route.ts` - Extended to return classified products with default_packaging_id
- `src/components/verpakking/ProductStatus.tsx` - Added classified products table with default packaging dropdown

## Decisions Made
- Classified products fetched inline in the existing products/status API endpoint rather than creating a separate endpoint, keeping a single data load for the ProductStatus page
- Default packaging column only shown for classified products (unclassified products have no use for default packaging)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in `src/lib/engine/packagingEngine.ts` (6 errors referencing undefined `bestSolution` variable at line 757/767/794). These are not caused by this plan's changes and are out of scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Default packaging data layer is complete and ready for Plan 03 (engine integration)
- Plans 05-02 (non-mixable handling) can proceed in parallel
- Admin UI is functional for setting up product-to-packaging mappings

---
*Phase: 05-engine-optimization*
*Completed: 2026-02-26*
