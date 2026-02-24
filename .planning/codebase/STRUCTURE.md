# Codebase Structure

**Analysis Date:** 2026-02-24

## Directory Layout

```
everyplants-batchmaker/
├── src/
│   ├── app/                              # Next.js App Router
│   │   ├── layout.tsx                    # Root HTML shell
│   │   ├── globals.css                   # Global styles
│   │   ├── (auth)/
│   │   │   └── login/page.tsx            # Login page
│   │   ├── (portal)/
│   │   │   ├── layout.tsx                # Shared layout with header + logout
│   │   │   └── page.tsx                  # Dashboard / module picker (route: /)
│   │   ├── (batchmaker)/batchmaker/
│   │   │   ├── batches/page.tsx          # Multi-order batching (route: /batchmaker/batches)
│   │   │   ├── batches/history/page.tsx  # Batch creation history
│   │   │   ├── single-orders/page.tsx    # Single order processing
│   │   │   ├── single-orders/history/    # Shipment history
│   │   │   └── settings/page.tsx         # Postal region management
│   │   ├── (floriday)/floriday/
│   │   │   ├── page.tsx                  # Floriday dashboard (route: /floriday)
│   │   │   ├── stock/page.tsx            # Stock overview
│   │   │   ├── orders/page.tsx           # Floriday orders
│   │   │   └── logs/page.tsx             # Sync logs
│   │   ├── (verpakkingsmodule)/verpakkingsmodule/
│   │   │   ├── page.tsx                  # Packing module root (route: /verpakkingsmodule)
│   │   │   ├── dashboard/page.tsx        # Stats
│   │   │   ├── instellingen/page.tsx     # Settings: packagings, tags, rules
│   │   │   ├── geschiedenis/page.tsx     # Session history
│   │   │   └── engine-log/page.tsx       # Engine advice log
│   │   └── api/                          # ~80 API route handlers
│   │       ├── auth/route.ts             # Login/logout
│   │       ├── orders/route.ts           # Batchmaker orders
│   │       ├── batches/create/route.ts   # Batch creation
│   │       ├── batches/history/route.ts
│   │       ├── single-orders/...         # Single order processing
│   │       ├── picqer/...                # Picqer proxy routes
│   │       ├── floriday/...              # Floriday integration routes
│   │       ├── verpakking/...            # Verpakkingsmodule routes
│   │       ├── admin/...                 # Admin utilities
│   │       └── inngest/route.ts          # Inngest background job handler
│   ├── components/
│   │   ├── BatchmakerClient.tsx          # Root client component for batchmaker
│   │   ├── SingleOrdersClient.tsx        # Root client component for single orders
│   │   ├── batches/                      # Batch history components
│   │   ├── filters/
│   │   │   └── FilterPanel.tsx           # Filter dropdowns for batchmaker
│   │   ├── floriday/                     # FloridayDashboard, FloridayStock, FloridayOrders, FloridaySyncLog
│   │   ├── layout/                       # Header, Footer
│   │   ├── orders/
│   │   │   └── OrdersTable.tsx           # Main orders table
│   │   ├── presets/
│   │   │   └── PresetsPanel.tsx          # Save/load filter presets
│   │   ├── settings/
│   │   │   └── PostalRegionsManager.tsx  # Postal region CRUD
│   │   ├── single-orders/               # GroupedOrdersTable, BatchHistory
│   │   ├── ui/                          # Shared UI primitives (Dialog, ConfirmDialog, TableSearch, etc.)
│   │   └── verpakking/                  # 20 components (see below)
│   ├── constants/
│   │   └── index.ts                     # RETAILERS, TAGS, COUNTRIES, DAYS, default PRESETS
│   ├── data/
│   │   └── mockVerpakkingData.ts        # Mock data for verpakkingsmodule development
│   ├── hooks/                           # 20 custom data-fetching hooks
│   ├── inngest/
│   │   ├── client.ts                    # Inngest client setup
│   │   ├── processSingleOrderBatch.ts   # Background job for single order processing
│   │   └── functions/
│   │       └── processSingleOrderBatch.ts
│   ├── lib/
│   │   ├── engine/
│   │   │   ├── packagingEngine.ts       # Packaging advice engine (1199 lines)
│   │   │   └── feedbackTracking.ts      # Tracks worker overrides of engine advice
│   │   ├── floriday/
│   │   │   ├── auth.ts                  # OAuth2 token management
│   │   │   ├── client.ts                # HTTP client with rate limiting
│   │   │   ├── config.ts                # Environment config (staging vs live)
│   │   │   ├── push-batch-service.ts    # Batch push orchestration
│   │   │   ├── stock-service.ts         # Stock calculation
│   │   │   ├── types.ts                 # 20+ Floriday TypeScript types
│   │   │   ├── mappers/                 # customer-resolver.ts, order-mapper.ts, product-resolver.ts
│   │   │   └── sync/                   # order-sync.ts, trade-item-sync.ts
│   │   ├── pdf/                         # PDF label editing via pdf-lib
│   │   ├── picqer/
│   │   │   ├── client.ts               # Rate-limited Picqer API client (2136 lines)
│   │   │   ├── transform.ts            # PicqerOrder → TransformedOrder
│   │   │   └── types.ts                # Picqer API types
│   │   ├── singleOrders/
│   │   │   └── grouping.ts             # Group single orders by product
│   │   └── supabase/
│   │       ├── client.ts               # Supabase client (no-cache, no-session)
│   │       ├── batchCreations.ts
│   │       ├── batchSessions.ts
│   │       ├── compartmentRules.ts
│   │       ├── excludedProducts.ts
│   │       ├── facturatieClient.ts     # Separate Supabase client for facturatie project
│   │       ├── localPackagings.ts
│   │       ├── localTags.ts
│   │       ├── packingSessions.ts      # Session + box + product CRUD (569 lines)
│   │       ├── postalRegions.ts
│   │       ├── presets.ts
│   │       ├── productAttributes.ts    # Product cache + classification (465 lines)
│   │       ├── shipmentLabels.ts
│   │       ├── shippingUnits.ts
│   │       ├── syncPackagingCosts.ts
│   │       └── tagMappings.ts
│   ├── middleware.ts                   # Auth cookie middleware
│   └── types/
│       ├── database.ts                 # Supabase schema types
│       ├── filters.ts                  # Filter state types
│       ├── order.ts                    # TransformedOrder, OrderTag
│       ├── preset.ts                   # Preset type
│       ├── singleOrder.ts              # SingleOrder, ProductGroup types
│       └── verpakking.ts               # Verpakkingsmodule domain types (~264 lines)
├── scripts/
│   ├── import-compartment-rules.ts    # One-time data import script
│   └── import-everspring.ts
├── CLAUDE.md                          # Project documentation for AI assistance
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Directory Purposes

**`src/app/(module)/`:**
- Purpose: Route groups for each functional module; each group has its own layout if needed
- Contains: Thin Server Component page files that mount Client Components
- Key files: `page.tsx` files that do nothing except `return <XxxClient />`

**`src/app/api/`:**
- Purpose: All server-side logic lives here; no business logic in Client Components
- Contains: One `route.ts` per endpoint; all start with `export const dynamic = 'force-dynamic'`
- Key files: `src/app/api/orders/route.ts`, `src/app/api/batches/create/route.ts`, `src/app/api/verpakking/engine/calculate/route.ts`

**`src/components/verpakking/`:**
- Purpose: All UI for the verpakkingsmodule (20 components)
- Contains: `WorkerSelector.tsx`, `BatchQueue.tsx`, `BatchOverview.tsx`, `VerpakkingsClient.tsx`, `BoxCard.tsx`, `ProductCard.tsx`, `BarcodeListener.tsx`, `ShipmentProgress.tsx`, `PackagingList.tsx`, `TagMappingSettings.tsx`, `CompartmentRules.tsx`, `ShippingUnitList.tsx`, `TagList.tsx`, `ProductStatus.tsx`, `Dashboard.tsx`, `EngineLog.tsx`, `SessionHistory.tsx`, `PicklistQueue.tsx`, `MentionTextarea.tsx`
- Key files: `VerpakkingsClient.tsx` (2277 lines - main packing screen), `BatchOverview.tsx` (1595 lines)

**`src/hooks/`:**
- Purpose: All data fetching and action logic consumed by Client Components
- Contains: 20 hooks; each module has its own set
- Key files: `useOrders.ts`, `useFilters.ts`, `usePackingSession.ts` (895 lines), `useBatchSession.ts` (733 lines), `useBatchQueue.ts`

**`src/lib/picqer/`:**
- Purpose: Complete Picqer API client; source of truth for operational data
- Contains: `client.ts` exports 40+ typed functions; `transform.ts` normalizes orders; `types.ts` defines all Picqer shapes
- Key files: `src/lib/picqer/client.ts` (2136 lines), `src/lib/picqer/transform.ts`

**`src/lib/supabase/`:**
- Purpose: Typed Supabase query helpers; one file per domain area
- Contains: 16 modules; all queries use `.schema('batchmaker').from('table')` (except `facturatieClient.ts`)
- Key files: `client.ts`, `packingSessions.ts`, `productAttributes.ts`

**`src/lib/engine/`:**
- Purpose: Packaging advice algorithm
- Contains: `packagingEngine.ts` (full algorithm), `feedbackTracking.ts` (deviation tracking)
- Key files: `src/lib/engine/packagingEngine.ts`

**`src/lib/floriday/`:**
- Purpose: Floriday marketplace integration
- Contains: OAuth2 auth, HTTP client, stock calculation, batch push, trade item sync, order sync, data mappers
- Key files: `src/lib/floriday/client.ts`, `src/lib/floriday/push-batch-service.ts`, `src/lib/floriday/stock-service.ts`

**`src/types/`:**
- Purpose: Shared domain types
- Contains: Types per domain; manually defined (Supabase type generator not used since tables are in `batchmaker` schema not `public`)
- Key files: `order.ts` (TransformedOrder), `database.ts` (Supabase row types), `verpakking.ts` (packing domain)

## Key File Locations

**Entry Points:**
- `src/middleware.ts`: Auth cookie enforcement for all page routes
- `src/app/layout.tsx`: Root HTML layout
- `src/app/(portal)/page.tsx`: Dashboard / navigation hub
- `src/app/api/inngest/route.ts`: Background job handler

**Configuration:**
- `src/constants/index.ts`: Retailer names, tag names, country codes, weekday names, default presets
- `src/lib/floriday/config.ts`: Floriday staging vs live environment config
- `tailwind.config.ts`: Tailwind configuration
- `tsconfig.json`: TypeScript config with `@/` path alias for `src/`

**Core Logic:**
- `src/lib/picqer/client.ts`: All Picqer API interactions
- `src/lib/picqer/transform.ts`: Order normalization
- `src/lib/engine/packagingEngine.ts`: Packaging advice algorithm
- `src/lib/floriday/push-batch-service.ts`: Floriday stock push
- `src/lib/supabase/packingSessions.ts`: Packing session state management

**Testing:**
- Not detected (no test files found)

## Naming Conventions

**Files:**
- React components: `PascalCase.tsx` (e.g., `BatchQueue.tsx`, `VerpakkingsClient.tsx`)
- Custom hooks: `camelCase.ts` with `use` prefix (e.g., `useBatchSession.ts`, `usePackingSession.ts`)
- API routes: always `route.ts` inside a directory that names the endpoint
- Lib modules: `camelCase.ts` or `kebab-case.ts` (e.g., `packagingEngine.ts`, `push-batch-service.ts`)
- Type files: `camelCase.ts` (e.g., `verpakking.ts`, `order.ts`)

**Directories:**
- Route groups: `(moduleName)` - parentheses notation for layout grouping without URL segment
- API subdirectories: kebab-case matching the URL path (e.g., `single-orders/`, `engine-log/`)
- Component subdirectories: kebab-case matching module/domain (e.g., `verpakking/`, `single-orders/`)
- Lib subdirectories: camelCase for third-party names (e.g., `floriday/`, `picqer/`, `supabase/`)

## Where to Add New Code

**New Page in Existing Module:**
1. Create `src/app/(module)/module/new-page/page.tsx` (Server Component, mounts Client Component)
2. Create `src/components/module/NewPageClient.tsx` (Client Component with `'use client'`)
3. Add navigation link to module layout or parent page

**New API Endpoint:**
1. Create `src/app/api/path/to/endpoint/route.ts`
2. Add `export const dynamic = 'force-dynamic'` at top
3. Validate request body inline
4. Call service lib functions; return `NextResponse.json()`
5. Follow error format: `{ error: string, details?: string }` with correct HTTP status

**New Hook:**
1. Create `src/hooks/useXxx.ts`
2. Start with `'use client'` and standard pattern:
   ```ts
   const [data, setData] = useState(null)
   const [isLoading, setIsLoading] = useState(true)
   const [error, setError] = useState(null)
   const fetchData = useCallback(async () => { ... }, [])
   useEffect(() => { fetchData() }, [fetchData])
   return { data, isLoading, error, refetch: fetchData }
   ```
3. For polling: add `setInterval(fetchData, intervalMs)` in `useEffect`

**New Picqer Integration:**
1. Add types to `src/lib/picqer/types.ts`
2. Add API function to `src/lib/picqer/client.ts` using `rateLimitedFetch()`
3. Create proxy route in `src/app/api/picqer/resource/route.ts`

**New Database Table:**
1. Apply migration via Supabase MCP tool
2. Add types to `src/types/database.ts`
3. Create helper module `src/lib/supabase/tableName.ts` with typed query functions
4. All queries must use: `supabase.schema('batchmaker').from('tableName')`

**New Supabase Query:**
- Always in `src/lib/supabase/` helper module, never inline in API routes or components
- Use `.schema('batchmaker').from(...)` - never call `.from()` directly without schema

**New Verpakkingsmodule Component:**
- Place in `src/components/verpakking/ComponentName.tsx`
- Add to the flow in `VerpakkingsClient.tsx` or the relevant session component

**Shared UI Primitives:**
- Place in `src/components/ui/`
- These must be generic (not module-specific)

**Constants:**
- Add to `src/constants/index.ts`

**Shared Types:**
- Domain types: `src/types/domain.ts`
- Database row types: extend `src/types/database.ts`

## Special Directories

**`src/app/(portal)/`:**
- Purpose: Route group for the shared portal layout (header with logout, navigation)
- Generated: No
- Committed: Yes — all modules render inside this layout

**`src/data/`:**
- Purpose: Mock data for development/testing of verpakkingsmodule
- Generated: No
- Committed: Yes — `mockVerpakkingData.ts` is a dev fixture

**`scripts/`:**
- Purpose: One-time data import scripts (not part of app runtime)
- Generated: No
- Committed: Yes — `import-compartment-rules.ts`, `import-everspring.ts`

**`.planning/`:**
- Purpose: Planning artifacts and codebase analysis documents
- Generated: Yes (by GSD tooling)
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build output
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-02-24*
