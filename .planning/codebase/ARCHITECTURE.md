# Architecture

**Analysis Date:** 2026-02-24

## Pattern Overview

**Overall:** Modular Next.js App Router application with 4 independent functional modules sharing common service/data layers.

**Key Characteristics:**
- Server Components as thin page wrappers that mount Client Components
- Client Components own all UI state and interact via internal API routes
- Custom hooks abstract all data fetching (fetch + polling pattern)
- Internal API routes act as proxies and orchestrators for external services
- Picqer is source of truth for operational data; Supabase stores configuration and session state
- `export const dynamic = 'force-dynamic'` on every API route (no caching)

## Layers

**Page Layer (Server Components):**
- Purpose: Route definition and thin mounting of Client Components
- Location: `src/app/(module)/module/path/page.tsx`
- Contains: Minimal wrappers, no logic
- Depends on: Client Components
- Used by: Next.js Router

**Client Component Layer:**
- Purpose: Full UI, filter state, action orchestration
- Location: `src/components/`
- Contains: `'use client'` components, local state, hook composition
- Depends on: Custom hooks, UI primitives
- Used by: Server page components

**Custom Hook Layer:**
- Purpose: Data fetching, polling, and action functions for components
- Location: `src/hooks/`
- Contains: `useState` + `useEffect` + `useCallback` + optional `setInterval` polling
- Depends on: Internal API routes (fetch calls to `/api/...`)
- Used by: Client Components

**API Route Layer:**
- Purpose: Server-side orchestration, external API proxying, business logic
- Location: `src/app/api/`
- Contains: `route.ts` files, validation, error handling
- Depends on: `src/lib/` modules
- Used by: Client hooks and external webhooks

**Service Library Layer:**
- Purpose: Reusable integrations and business logic
- Location: `src/lib/`
- Contains: Picqer client, Supabase helpers, engine, Floriday client, PDF utils
- Depends on: External APIs (Picqer, Supabase, Floriday), env vars
- Used by: API routes

**Type Layer:**
- Purpose: Shared TypeScript types
- Location: `src/types/`
- Contains: Domain types, database types, module-specific types
- Depends on: Nothing
- Used by: All layers

## Data Flow

**Batchmaker - Create Batch:**
1. `useOrders` hook fetches `GET /api/orders` on mount → API calls `fetchAllOrders()` from `src/lib/picqer/client.ts` → transforms via `src/lib/picqer/transform.ts`
2. `useFilters` applies client-side filtering to transformed orders
3. User clicks "Maak batch" → `BatchmakerClient.tsx` collects eligible `idPicklist` values
4. `POST /api/batches/create` → calls `createPicklistBatch()` in Picqer + fires Grive webhook + persists to `batchmaker.batch_creations` in Supabase

**Verpakkingsmodule - Packing Session:**
1. Worker selects themselves via `WorkerSelector.tsx` → stored in `sessionStorage`
2. `BatchQueue.tsx` / `useBatchQueue` fetches open batches from Picqer via `/api/picqer/picklist-batches`
3. Worker claims batch → `POST /api/verpakking/batch-sessions` → assigns picklist in Picqer + locks session in Supabase (`lock_expires_at`)
4. `VerpakkingsClient.tsx` / `usePackingSession` manages boxes and products; engine advice fetched via `POST /api/verpakking/engine/calculate`
5. Ship box: `POST /api/verpakking/sessions/[id]/ship` → `createShipment()` in Picqer → `getShipmentLabel()` → upload PDF to Supabase Storage → update box status

**Packaging Engine:**
1. `POST /api/verpakking/engine/calculate` → `calculateAdvice()` in `src/lib/engine/packagingEngine.ts`
2. `classifyOrderProducts` → looks up `product_attributes` in Supabase, syncs from Picqer if missing
3. `matchCompartments` → queries `compartment_rules` in Supabase
4. `rankPackagings` → specificity → volume → cost
5. `solveMultiBox` → greedy bin-packing if single box insufficient
6. Result persisted to Supabase + tags written to Picqer order via `addOrderTag()`

**Floriday Sync:**
1. Trade items: `POST /api/floriday/sync-trade-items` → sequence-based incremental sync → upsert to `floriday.trade_items`
2. Stock push: `POST /api/floriday/push-batch` → `pushBatchForProduct()` in `src/lib/floriday/push-batch-service.ts` → calculates bulk stock + PO batches → creates Floriday batches via OAuth2 API

**State Management:**
- UI filter state: `useState` in Client Components
- Packing session identity: `sessionStorage` keys `verpakking_active_batch_session`, `verpakking_active_session`
- Server-side session lock: `lock_expires_at` column in Supabase `packing_sessions` table (30-minute window, auto-refreshed)
- No global client-side state library (no Zustand/Redux/Context beyond Next.js)

## Key Abstractions

**TransformedOrder:**
- Purpose: Normalized order shape for the entire batchmaker UI
- Examples: `src/types/order.ts`, `src/lib/picqer/transform.ts`
- Pattern: Raw `PicqerOrder` → `transformOrder()` → `TransformedOrder` (flattens tags, custom fields, picklist status)

**rateLimitedFetch:**
- Purpose: All Picqer API calls go through this wrapper for concurrency control + exponential backoff
- Examples: `src/lib/picqer/client.ts` (all exported functions)
- Pattern: Global semaphore (max 3 concurrent), retry on 429 with exponential backoff

**PackagingAdviceResult:**
- Purpose: Engine output contract; shared between engine, API, and UI
- Examples: `src/lib/engine/packagingEngine.ts`, `src/types/verpakking.ts`
- Pattern: Immutable result object stored in Supabase and returned to client

**Supabase helper modules:**
- Purpose: Typed wrappers around Supabase queries scoped to `batchmaker` schema
- Examples: `src/lib/supabase/packingSessions.ts`, `src/lib/supabase/batchCreations.ts`
- Pattern: Each module exports named async functions; all queries use `.schema('batchmaker').from('table')`

**Action-based verpakking API routing:**
- Purpose: Verpakkingsmodule uses action-based routes instead of REST resource routes
- Examples: `POST /api/verpakking/packagings/create`, `PUT /api/verpakking/packagings/update`
- Pattern: Separate route files per action under the resource path

## Entry Points

**Root Layout:**
- Location: `src/app/layout.tsx`
- Triggers: All requests
- Responsibilities: HTML shell, global CSS import

**Auth Middleware:**
- Location: `src/middleware.ts`
- Triggers: All requests except `_next/static`, `_next/image`, `favicon.ico`
- Responsibilities: Cookie check (`auth=authenticated`); redirect to `/login` if unauthenticated; passes `/api/*` through without auth

**Portal Page:**
- Location: `src/app/(portal)/page.tsx`
- Triggers: GET `/`
- Responsibilities: Navigation hub to all 4 modules

**Module Pages:**
- Location: `src/app/(batchmaker)/batchmaker/batches/page.tsx`, `src/app/(verpakkingsmodule)/verpakkingsmodule/page.tsx`, `src/app/(floriday)/floriday/page.tsx`
- Triggers: Navigation to module routes
- Responsibilities: Mount the module's root Client Component

**Inngest Handler:**
- Location: `src/app/api/inngest/route.ts`
- Triggers: Inngest platform callbacks
- Responsibilities: Process background jobs (`processSingleOrderBatch`)

## Error Handling

**Strategy:** Catch-all try/catch at API route level; throw from service libraries

**Patterns:**
- API routes return structured JSON: `{ error: string, details?: string }` with appropriate HTTP status
- Status codes: 400=validation, 409=conflict, 422=business logic, 500=server error, 502=external service
- External API failures (Picqer, Floriday) throw typed Errors; API route catches and returns 502
- Webhook failures are logged but do not fail the primary operation (batch creation succeeds even if webhook fails)
- Packing session lock expiry: 30-minute timeout auto-resolves stale sessions without manual intervention

## Cross-Cutting Concerns

**Logging:** `console.log` / `console.error` throughout; structured log messages with operation context (e.g., `[engine/calculate]`, `[verpakking]`)

**Validation:** Inline in API routes before calling services; no shared validation library

**Authentication:** Cookie-based via `src/middleware.ts`; single shared `APP_PASSWORD`; no per-user identity in API routes (worker identity is tracked via `assigned_to` field using Picqer user ID)

---

*Architecture analysis: 2026-02-24*
