# Raapmodule — Design Spec

**Date:** 2026-03-16
**Status:** Approved

---

## Context

EveryPlants has a daily warehouse picking workflow. Currently there is no dedicated picking module — workers rely on Picqer's own pick interface. The Raapmodule integrates picking directly into the platform with category-specific flows, consolidated pick lists across batches, and special handling for outdoor plants (buitenplanten) picked by Adam (a non-digital warehouse worker).

---

## Problem Statement

1. **Buitenplanten tracking:** Adam picks outdoor/garden plants each morning from a printed list. If a batch is not fully packed and shipped that day, those plants are already physically staged but the system has no record of this. The next morning Adam would re-pick the same plants unnecessarily.

2. **No consolidated picking:** Workers currently pick batch by batch in Picqer. For pots and indoor plants, a consolidated list across all open batches (per category/carrier) would be more efficient.

3. **No category separation:** Kamerplanten, Buitenplanten, Kunstplanten, and Potten are physically in different warehouse zones (different Picqer locations). There is no tool that filters pick lists by zone.

---

## Solution

A new module `/raapmodule` with four category-specific picking flows, an internal Supabase tracking layer for buitenplanten, and a settings page to map Picqer locations to categories.

---

## Routes

```
/raapmodule                     → main screen (4 category tiles)
/raapmodule/buitenplanten       → Adam's export + verwerking
/raapmodule/potten              → carrier selection → consolidated pick list
/raapmodule/kamerplanten        → consolidated pick list
/raapmodule/kunstplanten        → consolidated pick list
/raapmodule/instellingen        → location-to-category mapping
```

---

## Architecture

### Category Detection

Products belong to a category based on their Picqer stock location. The settings page allows assigning Picqer location IDs to one of four categories: Kamerplanten, Buitenplanten, Kunstplanten, Potten.

Stored in `raap_category_locations` table.

### Pick List Generation

For any category, the consolidated pick list is built by:
1. Fetching all open Picqer picklist-batches
2. Fetching all picklists within those batches (each picklist carries `idshippingprovider_profile`)
3. For Potten: filter picklists to those whose `idshippingprovider_profile` belongs to the selected vervoerder (cross-reference via `vervoerder_profiles` in the existing vervoerders table)
4. Fetching all products within the (filtered) picklists
5. Filtering products whose stock location belongs to the target category
6. Grouping by product + location, summing quantities across all contributing picklists — resulting in one aggregated row per product+location combination (no single `picklist_id` on aggregated rows)

### Picqer Locations API

A new Picqer proxy route and client function must be built:
- Add `getLocations()` to `src/lib/picqer/client.ts` calling `GET /locations`
- Add `GET /api/picqer/locations` proxy route

---

## Flows

### 1. Buitenplanten — Adam's Flow

**Export:**
- Button generates an XLSX file (using `xlsx` / SheetJS — add as npm dependency)
- Contents: all buitenplanten products from open batches (location in "Buitenplanten" category), excluding items already recorded in `raap_picked_items` where the linked picklist is not yet closed
- Columns: product name, productcode, location, quantity needed, batch reference (Picqer batch ID)
- On load: delete stale `raap_picked_items` entries whose picklist status is `closed` (on-load cleanup, no cron needed)

**Verwerken (processing Adam's printed list):**
- Colleague opens `/raapmodule/buitenplanten` in the platform
- Same product list is shown with checkboxes
- Colleague checks off what Adam actually picked
- On save: checked items are written to `raap_picked_items` (picklist_batch_id, picklist_id, product_id, qty_picked)

**Tracking logic:**
- `raap_picked_items` records = "already picked, physically staged, do not re-pick"
- These items are excluded from the next morning's XLSX export
- Cleanup runs on every page load: delete rows where the associated picklist is now `closed` in Picqer

**Why not Picqer Containers:**
Picqer containers are designed for moving inventory between locations. Stock in a container is excluded from picklists, which would break the existing packing workflow. Internal Supabase tracking is the correct approach.

---

### 2. Potten Flow

1. Worker selects a vervoerder (carrier group) from the dropdown — reuses existing `vervoerders` table from batchmaker settings
2. System generates consolidated pick list using the join described in the Architecture section: picklists → filter by vervoerder shipping profiles → products → filter by Potten locations → group + sum
3. List shows: product name, location, total quantity needed (summed across batches)
4. Worker checks off lines as picked
5. Session state persisted in `raap_sessions` + `raap_session_items`
6. Only one `active` session per `category` + `vervoerder_id` combination is allowed. Creating a new session auto-completes any existing active session for the same combination.

**Tag-based carrier mapping** (from original brief):
- Tag = Plantura → Plantura vervoerder
- Tag = Open Doos / HEU / EWP / BLOK → XL vervoerder
- Everything else → PostNL/DPD vervoerder

This mapping is already handled by the existing vervoerder configuration in batchmaker settings (vervoerder groups map to Picqer shipping profiles).

---

### 3. Kamerplanten Flow

- Consolidated pick list of all Kamerplanten-category products across all open batches
- No carrier filter
- Checkbox per line
- Session state in Supabase
- Only one `active` session per `category` allowed at a time (auto-complete previous on new session create)

---

### 4. Kunstplanten Flow

- Same as Kamerplanten, using Kunstplanten category locations
- Checkbox per line
- Session state in Supabase
- Only one `active` session per `category` allowed at a time

---

## Settings Page

**Location mapping:**
- Fetch all Picqer locations via `GET /api/picqer/locations` (new route, see Architecture)
- Multi-select UI: assign each location to a category (or none)
- A location can only belong to one category
- Saved to `raap_category_locations`

**Vervoerders:**
- Reuse existing vervoerder management from `/batchmaker/settings`
- No new configuration needed in Raapmodule settings

---

## Database Schema

All tables in the `batchmaker` Supabase schema.

### `raap_category_locations`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `picqer_location_id` | integer | Picqer location ID (unique) |
| `picqer_location_name` | text | Display name (cached from Picqer) |
| `category` | text | `kamerplanten` / `buitenplanten` / `kunstplanten` / `potten` |
| `created_at` | timestamptz | |

### `raap_sessions`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `category` | text | Which category this session is for |
| `vervoerder_id` | uuid | FK to vervoerders (potten only, nullable) |
| `status` | text | `active` / `completed` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `completed_at` | timestamptz | |

Unique constraint: one `active` session per (`category`, `vervoerder_id`). For non-Potten categories where `vervoerder_id` is NULL, use a partial unique index (`WHERE status = 'active' AND vervoerder_id IS NULL`) since PostgreSQL treats NULLs as non-equal in standard unique constraints. Alternatively, use `NULLS NOT DISTINCT` (PostgreSQL 15+, supported in Supabase). Application layer must also auto-complete any existing active session for the same category+vervoerder combination before inserting a new one.

### `raap_session_items`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `session_id` | uuid | FK to raap_sessions |
| `product_id` | integer | Picqer product ID |
| `productcode` | text | |
| `product_name` | text | |
| `location` | text | Warehouse location |
| `qty_needed` | integer | Aggregated total across all contributing picklists |
| `qty_picked` | integer | |
| `checked` | boolean | Worker checked this line |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Note: items are aggregated rows (product + location), not per-picklist. No `picklist_id` column — quantities are summed across all picklists at session creation time.

### `raap_picked_items`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `picklist_batch_id` | integer | Picqer batch ID (for XLSX batch reference column) |
| `picklist_id` | integer | Picqer picklist ID (used for closed-picklist cleanup) |
| `product_id` | integer | Picqer product ID |
| `productcode` | text | |
| `product_name` | text | |
| `location` | text | Warehouse location |
| `qty_picked` | integer | |
| `picked_at` | timestamptz | When processed into Raapmodule |

---

## API Routes (new)

```
GET  /api/picqer/locations                    → proxy Picqer /locations (new)

GET  /api/raapmodule/export/buitenplanten     → generate XLSX
GET  /api/raapmodule/products/[category]      → consolidated pick list for category
                                                 potten: requires ?vervoerder_id=
POST /api/raapmodule/picked-items             → record picked items (buitenplanten)
GET  /api/raapmodule/picked-items             → get current picked items (with cleanup)
GET  /api/raapmodule/sessions                 → list sessions
POST /api/raapmodule/sessions                 → create session (auto-completes previous active)
PUT  /api/raapmodule/sessions/[id]            → update session (complete)
GET  /api/raapmodule/sessions/[id]/items      → get items for a session (for resume/refresh)
POST /api/raapmodule/sessions/[id]/items      → bulk upsert session items; replaces all items
                                                 for the session. Payload: array of item objects
                                                 (product_id, productcode, product_name, location,
                                                 qty_needed, qty_picked, checked). Called once when
                                                 the pick list is first generated, and again on each
                                                 checkbox save to persist updated checked/qty_picked state.
GET  /api/raapmodule/settings/locations       → get category-location mappings
POST /api/raapmodule/settings/locations       → save mappings
```

---

## Auth System Changes

Adding `module_raapmodule` requires changes in four places:

1. **Database migration:** add `module_raapmodule boolean default false` column to `user_profiles` table
2. **TypeScript type:** add `module_raapmodule: boolean` to `UserProfile` interface in `src/components/providers/AuthProvider.tsx`
3. **Admin API:** add `module_raapmodule` to `ALLOWED_FIELDS` in `src/app/api/admin/users/[id]/route.ts`
4. **Portal page:** add Raapmodule tile to `src/app/(portal)/page.tsx` MODULES array
5. **Admin UI:** add toggle in user management UI (`src/app/(admin)/admin/users/page.tsx`)

---

## Key Constraints & Notes

- **Picqer rate limits:** Fetching all products across all open batches can be many API calls. Use existing `rateLimitedFetch()` wrapper with batching of 5 concurrent requests.
- **Location caching:** Cache Picqer location names in `raap_category_locations` to avoid repeated API calls during pick list generation. Refresh on settings save.
- **XLSX generation:** Add `xlsx` (SheetJS) as an npm dependency (`npm install xlsx`). Not currently in the project.
- **Potten filter join:** The shipping profile filter for potten requires: fetch picklists → look up each picklist's `idshippingprovider_profile` → cross-reference with the selected vervoerder's profile IDs → only include matching picklists' products.
- **No real-time sync required:** Pick sessions are single-worker, no concurrency concerns unlike the verpakkingsmodule.
