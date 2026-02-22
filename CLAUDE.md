# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Environment Variables

Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `PICQER_SUBDOMAIN` - Picqer account subdomain
- `PICQER_API_KEY` - Picqer API key
- `GEMINI_API_KEY` - Google Gemini API key
- `N8N_BATCH_WEBHOOK_URL` - (optional) n8n webhook for batch creation
- `PASSWORD` - Password for basic auth protection
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

## Architecture Overview

The app is a Next.js 15 (App Router) application with four main modules, accessible from a portal homepage (`src/app/(portal)/page.tsx`).

### 1. Batchmaker — Multi-Order Batch Processing (`/batches`)

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

### 2. Single Orders — Product-Grouped Shipments (`/single-orders`)

Handles individual retail orders by grouping them by product (e.g., all Monstera orders together). Creates shipments, fetches PDF labels from Picqer, edits them to add the plant name, combines PDFs, and triggers printing via n8n.

**Flow:** Fetch orders → group by product → user selects product groups → create shipments in Picqer → fetch & edit PDF labels (add plant name) → upload to Supabase Storage → combine PDFs → trigger n8n webhook.

**Key files:**
- `src/components/SingleOrdersClient.tsx` — Main UI with product grouping and label generation
- `src/hooks/useSingleOrders.ts` — Single order data fetching
- `src/hooks/useSingleOrderFilters.ts` — Filter state management
- `src/inngest/functions/processSingleOrderBatch.ts` — Async label processing (Inngest background job with crash recovery)
- `src/app/api/single-orders/` — Single order and batch API routes

### 3. Verpakkingsmodule — Packaging Advice & Warehouse Packing (`/verpakkingsmodule`)

Replaces the discontinued Everspring system. A packaging recommendation engine that analyzes order products (type, pot size, height) and suggests the optimal shipping box. Warehouse workers see the suggestion in the packing UI and can accept or override it. The system tracks feedback to improve over time.

**Engine algorithm:** Classify products into shipping units (size ranges) → match against compartment rules (box configurations) → rank boxes by specificity/size/cost → write suggestion as a tag on the Picqer order.

**Key files:**
- `src/lib/engine/packagingEngine.ts` — Core packaging calculation engine
- `src/lib/engine/feedbackTracking.ts` — Feedback loop (suggested vs. actual packaging)
- `src/types/verpakking.ts` — Packaging type definitions
- `src/components/verpakking/VerpakkingsClient.tsx` — Main packing UI
- `src/components/verpakking/Dashboard.tsx` — Operational dashboard with stats/trends
- `src/components/verpakking/CompartmentRules.tsx` — Box configuration rules UI
- `src/components/verpakking/PackagingList.tsx` — Available packaging management
- `src/components/verpakking/TagMappingSettings.tsx` — Tag-to-packaging mapping settings
- `src/components/verpakking/PicklistQueue.tsx` / `BatchQueue.tsx` — Warehouse work queues
- `src/components/verpakking/SessionHistory.tsx` — Packing session history
- `src/components/verpakking/EngineLog.tsx` — Engine decision log for transparency
- `src/hooks/usePackingSession.ts` — Packing session state (auto-saved to Supabase)
- `src/hooks/useLocalPackagings.ts` / `useLocalTags.ts` / `useTagMappings.ts` — Packaging data hooks
- `src/hooks/useCompartmentRules.ts` — Compartment rule management
- `src/hooks/useWorker.ts` — Worker identity for multi-worker support
- `src/hooks/useBatchQueue.ts` / `useBatchSession.ts` / `usePicklistQueue.ts` — Queue hooks
- `src/app/api/verpakking/` — All packaging API routes (engine, sessions, packagings, rules, tags, dashboard)
- `supabase/migrations/20260210_verpakkingsmodule.sql` — Database schema

**Supabase tables (verpakkingsmodule):**
- `product_attributes` — Cached Picqer products with classifications (pot size, height, type, fragility)
- `shipping_units` — Classification ranges (e.g., "PLANT | P17-P21 | H0-H100")
- `compartment_rules` — Box configuration rules (which product types fit, alternatives, AND/OR logic)
- `packaging_advice` — Engine results per order (suggestion, confidence, accepted/overridden)

### 4. Floriday Integration — B2B Marketplace Sync (`/floriday`)

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
- `client.ts` — Supabase client initialization
- Data layer modules: `packingSessions.ts`, `localPackagings.ts`, `localTags.ts`, `tagMappings.ts`, `compartmentRules.ts`, `shipmentLabels.ts`, `syncPackagingCosts.ts`
- Uses `batchmaker` schema (not `public`)

**Authentication:**
Simple cookie-based auth via middleware (`src/middleware.ts`). The `/login` page validates against `PASSWORD` env var and sets an `auth` cookie.

### Type Definitions

- `src/types/order.ts` — Transformed order types used in batches UI
- `src/types/singleOrder.ts` — Single order types with product grouping
- `src/types/verpakking.ts` — Packaging module types
- `src/types/database.ts` — Supabase schema types (manually defined for `batchmaker` schema)
- `src/lib/picqer/types.ts` — Picqer API response types
- `src/lib/floriday/types.ts` — Floriday API types

### Tech Stack

- **Framework:** Next.js 15 (App Router) + React 18
- **Database:** Supabase (PostgreSQL, `batchmaker` schema)
- **Storage:** Supabase Storage buckets (shipment labels)
- **External APIs:** Picqer, Floriday, n8n webhooks
- **Background jobs:** Inngest
- **UI:** Tailwind CSS, shadcn/ui, Radix UI, Lucide icons
- **PDF:** pdf-lib (label editing and combining)

## Supabase MCP

Use the Supabase MCP (Model Context Protocol) tools to interact with Supabase for database operations, migrations, and schema changes.
