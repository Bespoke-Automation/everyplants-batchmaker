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
2. Fetching all picklists within those batches
3. Fetching all products within those picklists
4. Filtering products whose stock location belongs to the target category
5. Grouping by product + location, summing quantities across picklists

For Potten, an additional filter is applied: only orders whose shipping profile belongs to the selected vervoerder.

---

## Flows

### 1. Buitenplanten — Adam's Flow

**Export:**
- Button generates an XLSX file
- Contents: all buitenplanten products from open batches (location in "Buitenplanten" category), excluding items already recorded in `raap_picked_items` (already picked, not yet in a closed picklist)
- Columns: product name, productcode, location, quantity needed, batch reference

**Verwerken (processing Adam's printed list):**
- Colleague opens `/raapmodule/buitenplanten` in the platform
- Same product list is shown with checkboxes
- Colleague checks off what Adam actually picked
- On save: checked items are written to `raap_picked_items` (picklist_id, product_id, qty_picked)

**Tracking logic:**
- `raap_picked_items` records = "already picked, physically staged, do not re-pick"
- These items are excluded from the next morning's XLSX export
- When a picklist status becomes `closed` in Picqer, associated `raap_picked_items` entries are no longer relevant (the order is fully processed)
- Cleanup: items linked to closed picklists are excluded from export logic; a periodic or on-load cleanup can delete stale entries

**Why not Picqer Containers:**
Picqer containers are designed for moving inventory between locations. Stock in a container is excluded from picklists, which would break the existing packing workflow. Internal Supabase tracking is the correct approach.

---

### 2. Potten Flow

1. Worker selects a vervoerder (carrier group) from the dropdown — reuses existing `vervoerders` table from batchmaker settings
2. System generates consolidated pick list: all Potten-category products across all open batches whose orders use a shipping profile belonging to the selected vervoerder
3. List shows: product name, location, total quantity needed (summed across batches)
4. Worker checks off lines as picked
5. Session state persisted in `raap_sessions` + `raap_session_items`

**Tag-based carrier mapping** (from original brief):
- Tag = Plantura → Plantura vervoerder
- Tag = Open Doos / HEU / EWP / BLOK → XL vervoerder
- Everything else → PostNL/DPD vervoerder

This mapping is already handled by the existing vervoerder configuration in batchmaker settings.

---

### 3. Kamerplanten Flow

- Consolidated pick list of all Kamerplanten-category products across all open batches
- No carrier filter
- Checkbox per line
- Session state in Supabase

---

### 4. Kunstplanten Flow

- Same as Kamerplanten, using Kunstplanten category locations
- Checkbox per line
- Session state in Supabase

---

## Settings Page

**Location mapping:**
- Fetch all Picqer locations via `/api/picqer/locations`
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
| `picqer_location_id` | integer | Picqer location ID |
| `picqer_location_name` | text | Display name (cached) |
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
| `completed_at` | timestamptz | |

### `raap_session_items`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `session_id` | uuid | FK to raap_sessions |
| `picklist_id` | integer | Picqer picklist ID |
| `product_id` | integer | Picqer product ID |
| `productcode` | text | |
| `product_name` | text | |
| `location` | text | Warehouse location |
| `qty_needed` | integer | |
| `qty_picked` | integer | |
| `checked` | boolean | Worker checked this line |
| `created_at` | timestamptz | |

### `raap_picked_items`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `picklist_id` | integer | Picqer picklist ID |
| `product_id` | integer | Picqer product ID |
| `productcode` | text | |
| `product_name` | text | |
| `qty_picked` | integer | |
| `picked_at` | timestamptz | When processed into Raapmodule |

---

## API Routes (new)

```
GET  /api/raapmodule/export/buitenplanten     → generate XLSX
GET  /api/raapmodule/products/[category]      → consolidated pick list for category
GET  /api/raapmodule/products/potten          → with ?vervoerder_id= filter
POST /api/raapmodule/picked-items             → record picked items (buitenplanten)
GET  /api/raapmodule/picked-items             → get current picked items
GET  /api/raapmodule/sessions                 → list sessions
POST /api/raapmodule/sessions                 → create session
PUT  /api/raapmodule/sessions/[id]            → update session (complete)
POST /api/raapmodule/sessions/[id]/items      → save checked items
GET  /api/raapmodule/settings/locations       → get category-location mappings
POST /api/raapmodule/settings/locations       → save mappings
```

---

## Key Constraints & Notes

- **Picqer rate limits:** Fetching all products across all open batches can be many API calls. Use existing `rateLimitedFetch()` wrapper with batching of 5 concurrent requests.
- **Location caching:** Cache Picqer location names in `raap_category_locations` to avoid repeated API calls during pick list generation.
- **XLSX generation:** Use a library like `xlsx` (SheetJS) — already may be in the project, or add as dependency.
- **Module access:** Add `module_raapmodule` permission key to the auth system alongside existing module keys.
- **No real-time sync required:** Pick sessions are single-worker, no concurrency concerns unlike the verpakkingsmodule.
