# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint (Next.js default config, no custom .eslintrc)
```

There are no tests in this project. Do not look for or suggest running test commands.

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `PICQER_SUBDOMAIN` - Picqer account subdomain
- `PICQER_API_KEY` - Picqer API key
- `GEMINI_API_KEY` - Google Gemini API key
- `N8N_BATCH_WEBHOOK_URL` - (optional) n8n webhook for batch creation
- `APP_PASSWORD` - Password for basic auth protection
- `FLORIDAY_CLIENT_ID` - Floriday OAuth2 client ID
- `FLORIDAY_CLIENT_SECRET` - Floriday OAuth2 client secret
- `FLORIDAY_API_KEY` - Floriday API key
- `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` - Inngest background job keys

## Business Context

EveryPlants is a Dutch plant e-commerce company that sells plants to retailers, florists, and garden centers. This application — the **Batchmaker** — is their internal logistics management tool. It orchestrates the full order-to-shipment pipeline: grouping orders into efficient batches, selecting the right packaging, generating shipping labels, and syncing with external sales channels.

The tool replaces several previously manual or disconnected workflows:
- Orders used to be grouped by hand in Picqer
- Packaging decisions were made by an external system (Everspring) that's being discontinued
- Floriday marketplace orders had to be entered manually into Picqer

### External Systems

- **Picqer** — Warehouse management system (WMS). Source of truth for orders, products, picklists, shipments, and customers.
- **Supabase** — PostgreSQL database for app state: presets, settings, packing sessions, shipment labels, packaging feedback, and Floriday sync state. Uses the `batchmaker` schema (not `public`).
- **Floriday** — Dutch B2B plant wholesale marketplace where EveryPlants is a supplier. Professional buyers place orders here.
- **n8n** — Webhook-based automation platform that triggers label printing in the warehouse.
- **Inngest** — Serverless background job processing for async label generation and batch operations.

## Coding Conventions

### Language

- **Code** (variables, functions, routes, types): English
- **UI text** (labels, buttons, error messages, placeholders): Dutch
- **Database fields** (business domain terms): Dutch — e.g., `bezorgland`, `leverdag`, `plantnummer`, `naam`
- **Locale formatting**: Always use `'nl-NL'` for dates and numbers — e.g., `date.toLocaleDateString('nl-NL', { ... })`

### Import Alias

`@/*` resolves to `./src/*` (configured in `tsconfig.json`). Always use `@/` imports, never relative paths across directories.

### TypeScript

- Strict mode is enabled. No `any` types, always narrow `unknown`.
- Type definitions live in `src/types/` for domain types and alongside their module for API types.
- Supabase schema types in `src/types/database.ts` are manually defined (not auto-generated).

### Component Patterns

- **UI components are custom** — not a shadcn/ui library install. Components in `src/components/ui/` (Dialog, ConfirmDialog, etc.) are hand-written.
- **Page structure**: Pages are thin server components that render a `'use client'` client component (e.g., `page.tsx` renders `<BatchmakerClient />`).
- **Layouts per route group** contain the module's navigation header and logout button.
- **Icons**: Lucide React (`lucide-react`) — do not introduce other icon libraries.
- **Drag-and-drop**: `@dnd-kit` for sortable/draggable interactions in the verpakkingsmodule.

### Custom Hook Pattern

All data fetching hooks follow the same structure (no SWR, no React Query):

```typescript
'use client'
export function useExample() {
  const [data, setData] = useState<T | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/...', { signal })
      if (!response.ok) throw new Error(...)
      setData(await response.json())
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const ac = new AbortController()
    fetchData(ac.signal)
    return () => ac.abort()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}
```

Some hooks add **polling** with `setInterval` (5s for queues, 30s for comments). Always clean up intervals in the effect return.

### API Route Patterns

All API routes follow these conventions:

1. **Always export** `export const dynamic = 'force-dynamic'` to prevent Next.js caching.
2. **Error response shape**: `{ error: string, details?: string }` with appropriate status codes:
   - `400` — Validation errors (missing fields, invalid types)
   - `409` — Conflict (already claimed, wrong status)
   - `500` — Server errors (Picqer/Supabase failures)
   - `502` — External service unreachable
3. **Error logging**: `console.error('[module] Description:', error)` with context prefix.
4. **Error extraction**: `error instanceof Error ? error.message : 'Unknown error'`
5. **Non-critical failures** (webhook triggers, Picqer assignment) are caught separately and returned as warnings, not errors.

### Supabase Query Patterns

- **Always use** `.schema('batchmaker')` — never query the default `public` schema.
- **Error handling**: Check for error, `console.error`, then `throw`. Let the API route catch and format the response.
- **Selects**: Return `data || []` for lists, use `.single()` for one row, `.maybeSingle()` when the row may not exist.
- **Inserts/Updates**: Always chain `.select()` to return the created/updated row.
- **Pagination**: Use `.range(offset, offset + limit - 1)` with `.order()`.
- **Conditional updates**: Use `.eq()` / `.in()` filters to make updates atomic (e.g., only update if status matches).
- **Supabase client** is configured with `cache: 'no-store'` and `persistSession: false` to avoid stale data in the Next.js server environment.

### Picqer API Client

The Picqer client (`src/lib/picqer/client.ts`) has built-in rate limiting:
- **Max 3 concurrent requests** (global queue-based limiter) — Picqer allows 500 req/min but we limit concurrency to prevent stampedes
- **5 retries** with exponential backoff on 429 (rate limit) responses, respects `Retry-After` header
- **Auth**: HTTP Basic with API key, User-Agent `EveryPlants-Batchmaker/2.0`
- **Pagination**: Offset-based, 100 items per page, safety limits (3000 orders max, 1000 products max)

When writing new code that calls Picqer, always use the functions in `client.ts` — never call the Picqer API directly with `fetch`.

### Inngest Background Jobs

Background jobs use the `step.run()` pattern for checkpointing and crash recovery:

```typescript
export const myFunction = inngest.createFunction(
  { id: "my-function", retries: 3 },
  { event: "my/event.name" },
  async ({ event, step }) => {
    const result = await step.run("step-name", async () => { ... })
    // Each step is independently retryable
  }
)
```

Register new functions in `src/app/api/inngest/route.ts`.

## Architecture Overview

The app is a Next.js 15 (App Router) + React 19 application with four main modules, accessible from a portal homepage (`src/app/(portal)/page.tsx`).

### Route Structure

```
src/app/
  (portal)/                          → /                    Portal homepage
  (batchmaker)/batchmaker/
    batches/                         → /batchmaker/batches   Multi-order batches
    batches/history/                 → /batchmaker/batches/history
    single-orders/                   → /batchmaker/single-orders
    single-orders/history/           → /batchmaker/single-orders/history
    settings/                        → /batchmaker/settings  Postal regions
  (verpakkingsmodule)/verpakkingsmodule/
    /                                → /verpakkingsmodule    Picklist queue
    dashboard/                       → /verpakkingsmodule/dashboard
    geschiedenis/                    → /verpakkingsmodule/geschiedenis
    engine-log/                      → /verpakkingsmodule/engine-log
    instellingen/                    → /verpakkingsmodule/instellingen
  (floriday)/floriday/
    /                                → /floriday             Dashboard
    orders/                          → /floriday/orders
    stock/                           → /floriday/stock
  (auth)/login/                      → /login
```

Route groups `(portal)`, `(batchmaker)`, `(verpakkingsmodule)`, `(floriday)`, and `(auth)` each have their own layout with navigation. New features should follow this pattern: create a route group with its own layout.

### 1. Batchmaker — Multi-Order Batch Processing

Groups multiple Picqer orders into shipment batches to reduce shipping costs and streamline warehouse picking.

**Flow:** Fetch orders from Picqer → filter by retailer/country/postal region/delivery date → user selects picklists → create batch → trigger n8n webhook for label printing.

**Key files:**
- `src/components/BatchmakerClient.tsx` — Main UI with filtering, presets, and batch creation
- `src/hooks/useOrders.ts` — Order data fetching
- `src/hooks/useFilters.ts` — Filter state management
- `src/hooks/usePresets.ts` — Preset CRUD operations
- `src/hooks/usePostalRegions.ts` — Postal region management
- `src/app/api/orders/` — Order API routes
- `src/app/api/batches/` — Batch creation API

### 2. Single Orders — Product-Grouped Shipments

Handles individual retail orders by grouping them by product (e.g., all Monstera orders together). Creates shipments, fetches PDF labels from Picqer, edits them to add the plant name, combines PDFs, and triggers printing via n8n.

**Flow:** Fetch orders → group by product → user selects product groups → create shipments in Picqer → fetch & edit PDF labels (add plant name) → upload to Supabase Storage → combine PDFs → trigger n8n webhook.

**Key files:**
- `src/components/SingleOrdersClient.tsx` — Main UI with product grouping and label generation
- `src/hooks/useSingleOrders.ts` — Single order data fetching
- `src/hooks/useSingleOrderFilters.ts` — Filter state management
- `src/inngest/functions/processSingleOrderBatch.ts` — Async label processing (Inngest background job with crash recovery)
- `src/app/api/single-orders/` — Single order and batch API routes

### 3. Verpakkingsmodule — Packaging Advice & Warehouse Packing

Replaces the discontinued Everspring system. A packaging recommendation engine that analyzes order products (type, pot size, height) and suggests the optimal shipping box. Warehouse workers see the suggestion in the packing UI and can accept or override it. The system tracks feedback to improve over time.

**Engine algorithm:** Classify products into shipping units (size ranges) → match against compartment rules (box configurations) → rank boxes by specificity/size/cost → write suggestion as a tag on the Picqer order.

**Key files:**
- `src/lib/engine/packagingEngine.ts` — Core packaging calculation engine
- `src/lib/engine/feedbackTracking.ts` — Feedback loop (suggested vs. actual packaging)
- `src/types/verpakking.ts` — Packaging type definitions
- `src/components/verpakking/` — All packing UI components
- `src/hooks/usePackingSession.ts` — Packing session state (auto-saved to Supabase)
- `src/hooks/useLocalPackagings.ts` / `useLocalTags.ts` / `useTagMappings.ts` — Packaging data hooks
- `src/hooks/useCompartmentRules.ts` — Compartment rule management
- `src/hooks/useWorker.ts` — Worker identity for multi-worker support
- `src/hooks/useBatchQueue.ts` / `useBatchSession.ts` / `usePicklistQueue.ts` — Queue hooks (5s polling)
- `src/app/api/verpakking/` — All packaging API routes (engine, sessions, packagings, rules, tags, dashboard)
- `supabase/migrations/20260210_verpakkingsmodule.sql` — Database schema

**Supabase tables (verpakkingsmodule):**
- `product_attributes` — Cached Picqer products with classifications (pot size, height, type, fragility)
- `shipping_units` — Classification ranges (e.g., "PLANT | P17-P21 | H0-H100")
- `compartment_rules` — Box configuration rules (which product types fit, alternatives, AND/OR logic with `EN`/`OF`/`ALTERNATIEF` operators)
- `packaging_advice` — Engine results per order (suggestion, confidence, accepted/overridden)

### 4. Floriday Integration — B2B Marketplace Sync

Syncs sales orders from the Floriday B2B plant marketplace into Picqer. Floriday buyers place orders → the integration maps customers, products, and delivery details → creates orders in Picqer automatically. Orders then flow through the normal batchmaker workflow.

**Flow:** Poll Floriday API for new sales orders → resolve customer (Floriday org → Picqer customer) → resolve products (Floriday article code → Picqer product via "Alternatieve SKU") → map fulfillment details (trolley types, delivery address via GLN) → create order in Picqer with "Floriday" tag.

**Key files:**
- `src/lib/floriday/client.ts` — Floriday API client (rate-limited, OAuth2 auth)
- `src/lib/floriday/auth.ts` — OAuth2 authentication
- `src/lib/floriday/types.ts` — Floriday API types
- `src/lib/floriday/sync/order-sync.ts` — Order synchronization
- `src/lib/floriday/sync/trade-item-sync.ts` — Trade item (product) sync
- `src/lib/floriday/stock-service.ts` — Stock management
- `src/lib/floriday/push-batch-service.ts` — Push batches to Floriday
- `src/lib/floriday/mappers/` — Order mapper, product resolver, customer resolver
- `src/components/floriday/` — Dashboard, orders, stock, and sync log UI
- `src/app/api/floriday/` — API routes (auth, webhooks, sync, orders, stock, mapped products)

**Supabase tables (Floriday):**
- `order_mapping` — Tracks which Floriday orders became Picqer orders
- `customer_mapping` — Caches Floriday org IDs → Picqer customer IDs
- `product_mapping` — Caches Floriday article codes → Picqer product IDs
- `warehouse_cache` — GLN codes → delivery addresses
- `sync_log` — Audit trail for all sync operations

### Shared Infrastructure

**Picqer API** (`src/lib/picqer/`):
- `client.ts` — Core API client with rate limiting and retry logic
- `transform.ts` — Transforms raw Picqer data into app types
- `types.ts` — Picqer API response types
- Uses 30-second in-memory cache for orders

**Supabase** (`src/lib/supabase/`):
- `client.ts` — Supabase client initialization (no-cache, no session persistence)
- Data layer modules: one file per entity (e.g., `packingSessions.ts`, `localPackagings.ts`, `compartmentRules.ts`)
- Uses `batchmaker` schema (not `public`)

**Authentication:**
Simple cookie-based auth via middleware (`src/middleware.ts`). The `/login` page validates against `APP_PASSWORD` env var and sets an `auth` cookie (7-day expiry, httpOnly, sameSite lax). API routes (`/api/*`) are **not** protected by the middleware — they pass through without auth checks.

### Type Definitions

- `src/types/order.ts` — Transformed order types used in batches UI
- `src/types/singleOrder.ts` — Single order types with product grouping
- `src/types/verpakking.ts` — Packaging module types
- `src/types/database.ts` — Supabase schema types (manually defined for `batchmaker` schema)
- `src/lib/picqer/types.ts` — Picqer API response types
- `src/lib/floriday/types.ts` — Floriday API types

### Tech Stack

- **Framework:** Next.js 15 (App Router) + React 19
- **Database:** Supabase (PostgreSQL, `batchmaker` schema)
- **Storage:** Supabase Storage buckets (shipment labels, packaging images)
- **External APIs:** Picqer, Floriday, n8n webhooks
- **Background jobs:** Inngest
- **UI:** Tailwind CSS 3 with custom theme (primary: `#023c2d` EveryPlants green), Lucide icons, @dnd-kit
- **PDF:** pdf-lib (label editing and combining)
- **Font:** Geist Sans / Geist Mono

### File Organization for New Features

```
src/
  app/
    (route-group)/module-name/      # Pages (thin server components)
    api/module-name/                # API routes
  components/module-name/           # Client components
  hooks/                            # Custom hooks (flat, prefixed with use)
  lib/module-name/                  # Business logic, API clients, data layer
  types/                            # Type definitions
```

## Gotchas

- **Supabase schema**: Always `.schema('batchmaker')` — forgetting this queries the empty `public` schema and returns no results.
- **API routes are unprotected**: Middleware lets `/api/*` pass through. Do not put sensitive operations behind API routes without additional auth.
- **Next.js caching disabled**: The Supabase client forces `cache: 'no-store'` and all API routes use `force-dynamic`. This is intentional — data must always be fresh.
- **Picqer concurrency**: Max 3 concurrent requests. New Picqer-calling code must use the existing `client.ts` functions, not raw `fetch`.
- **No utility library**: There is no shared `utils.ts`. Formatting is done inline. Do not create a utility file for one-off helpers.
- **Manual Supabase types**: `src/types/database.ts` is manually maintained. When changing the DB schema, update this file too.
- **Packing session locking**: The verpakkingsmodule uses pessimistic locking with `lock_expires_at` (30-minute windows) in Supabase to prevent two workers from claiming the same picklist.

## Supabase MCP

Use the Supabase MCP (Model Context Protocol) tools to interact with Supabase for database operations, migrations, and schema changes.
