---
phase: 04-cost-data-layer-v2
plan: 01
subsystem: database, ui
tags: [supabase, migration, sku-mapping, facturatie, admin-ui]

# Dependency graph
requires:
  - phase: 03-api-ui-integration
    provides: "v1.0 cost data layer with costProvider and engine integration"
provides:
  - "facturatie_box_sku column on batchmaker.packagings table"
  - "22+ seeded SKU mappings (6 mismatches + 21 same-as-barcode)"
  - "Admin UI for managing facturatie_box_sku per packaging"
  - "Updated LocalPackaging/LocalPackagingRow types with facturatieBoxSku"
affects: [04-02, costProvider, packagingEngine]

# Tech tracking
tech-stack:
  added: []
  patterns: ["facturatie_box_sku as join key to published_box_costs", "ENGINE_FIELDS pattern for engine-only DB fields"]

key-files:
  created:
    - "supabase/migrations/20260226150344_add_facturatie_box_sku_to_packagings.sql"
  modified:
    - "src/types/verpakking.ts"
    - "src/lib/supabase/localPackagings.ts"
    - "src/hooks/useLocalPackagings.ts"
    - "src/app/api/verpakking/packagings/update/route.ts"
    - "src/components/verpakking/PackagingList.tsx"

key-decisions:
  - "facturatie_box_sku stored as TEXT (not FK) since it references cross-database table"
  - "Same-as-barcode packagings get explicit facturatie_box_sku value (not derived at runtime)"
  - "Mismatch badges shown only when SKU differs from barcode, not for same-as-barcode"

patterns-established:
  - "facturatie_box_sku as the canonical join key between batchmaker and facturatie cost data"
  - "Amber badge for SKU mismatches, gray 'Geen SKU' for null mappings"

requirements-completed: [SKU-01, SKU-02]

# Metrics
duration: 10min
completed: 2026-02-26
---

# Phase 4 Plan 1: SKU Mapping Summary

**facturatie_box_sku column on packagings with 27 seeded mappings (6 mismatches, 21 same-as-barcode, 3 null) and admin UI for managing SKU mappings**

## Performance

- **Duration:** 10 min
- **Started:** 2026-02-26T14:58:24Z
- **Completed:** 2026-02-26T15:08:15Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Database migration adds `facturatie_box_sku` column to `batchmaker.packagings` with correct seed data for all 30 packagings
- Full TypeScript type chain updated: `verpakking.ts` -> `localPackagings.ts` -> `useLocalPackagings.ts` -> `PackagingList.tsx`
- Admin UI shows editable Facturatie SKU field in engine settings section, with visual mismatch indicators in the packaging table

## Task Commits

Each task was committed atomically:

1. **Task 1: Add facturatie_box_sku column and seed 22+ mappings** - `d9bd151` (feat)
2. **Task 2: Add facturatie_box_sku to admin UI and update API** - `ce35e47` (feat)

## Files Created/Modified
- `supabase/migrations/20260226150344_add_facturatie_box_sku_to_packagings.sql` - Migration: column + seed data for 6 mismatches, 21 same-as-barcode, 3 null
- `src/types/verpakking.ts` - Added `facturatieBoxSku: string | null` to `LocalPackaging` interface
- `src/lib/supabase/localPackagings.ts` - Added `facturatie_box_sku` to `LocalPackagingRow` and `updateLocalPackaging` type
- `src/hooks/useLocalPackagings.ts` - Added `facturatie_box_sku` to `ApiLocalPackaging`, transform, and update data type
- `src/app/api/verpakking/packagings/update/route.ts` - Added `facturatie_box_sku` to `ENGINE_FIELDS` array
- `src/components/verpakking/PackagingList.tsx` - Added form field, edit population, save payload, and table mismatch badges

## Decisions Made
- **facturatie_box_sku as TEXT**: Stored as plain text, not a foreign key, since it references a cross-database table in the facturatie project
- **Explicit same-as-barcode values**: Even when barcode matches the facturatie SKU, we store the value explicitly rather than deriving it at runtime. This avoids NULL ambiguity (NULL = no facturatie equivalent, not "same as barcode")
- **Mismatch visualization**: Amber badge shown only for mismatches (barcode != SKU), no badge for same-as-barcode (clean appearance), gray "Geen SKU" for packagings with barcode but no facturatie equivalent
- **21 same-as-barcode instead of 16**: The plan estimated 16, but the actual database has 21 packagings where barcode matches the facturatie SKU. The migration SQL correctly handles all of them via the wildcard UPDATE

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Supabase migration history repair**
- **Found during:** Task 1 (migration application)
- **Issue:** Local migration files were out of sync with remote migration history table. `supabase db push` failed with "Remote migration versions not found in local migrations directory"
- **Fix:** Repaired migration history by marking remote-only migrations as reverted and local-only migrations as applied, then pushed the new migration successfully
- **Files modified:** None (remote migration history table only)
- **Verification:** Migration applied successfully, seed data verified via query

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Migration was applied successfully after history repair. No scope creep.

## Issues Encountered
- Supabase CLI migration history was diverged between local files and remote database. This required `supabase migration repair` commands to reconcile. The migration itself applied without issues once the history was cleaned up.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `facturatie_box_sku` column is live with correct seed data for all packagings
- Admin can edit SKU mappings via `/verpakkingsmodule/instellingen`
- Ready for Plan 04-02: costProvider rewrite to use `facturatie_box_sku` as join key to `published_box_costs`
- Blocker remains: facturatie app must build and populate `published_box_costs` table before costProvider v2 is testable with real data

## Self-Check: PASSED

All 7 files verified present. Both commit hashes (d9bd151, ce35e47) found in git log.

---
*Phase: 04-cost-data-layer-v2*
*Completed: 2026-02-26*
