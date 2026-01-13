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

## Architecture Overview

This is an internal order batch management tool for EveryPlants that integrates with Picqer (warehouse management) and Supabase (data persistence).

### Key Integrations

**Picqer API** (`src/lib/picqer/`):
- `client.ts` - Core Picqer API client with rate limiting and retry logic
- Handles orders, picklists, shipments, and batch creation
- Uses 30-second in-memory cache for orders

**Supabase** (`src/lib/supabase/`):
- `client.ts` - Supabase client initialization
- Stores presets, excluded products, postal regions, and shipment labels
- Uses `batchmaker` schema (not `public`)

### App Structure

- `/batches` - Multi-order batch creation with filtering
- `/single-orders` - Individual order processing with shipment label generation
- `/single-orders/history` - Batch processing history
- `/settings` - Postal regions configuration

### Core Components

**Client Components** (`src/components/`):
- `BatchmakerClient.tsx` - Main batches page with filtering, presets, and batch creation
- `SingleOrdersClient.tsx` - Single order processing with grouping and label generation

**Hooks** (`src/hooks/`):
- `useOrders.ts` / `useSingleOrders.ts` - Data fetching with SWR-like pattern
- `useFilters.ts` / `useSingleOrderFilters.ts` - Filter state management
- `usePresets.ts` - Preset CRUD operations
- `usePostalRegions.ts` - Postal region management

### Authentication

Simple cookie-based auth via middleware (`src/middleware.ts`). The `/login` page validates against `PASSWORD` env var and sets an `auth` cookie.

### Data Flow

1. Orders fetched from Picqer API via `/api/orders` or `/api/single-orders`
2. Transformed using `src/lib/picqer/transform.ts`
3. Filtered client-side using hooks
4. Batch creation calls Picqer API and optionally triggers n8n webhook
5. Presets/settings persisted to Supabase

### Type Definitions

- `src/types/order.ts` - Transformed order types used in UI
- `src/types/singleOrder.ts` - Single order types with grouping
- `src/types/database.ts` - Supabase schema types (manually defined for `batchmaker` schema)
- `src/lib/picqer/types.ts` - Picqer API response types

## Supabase MCP

Use the Supabase MCP (Model Context Protocol) tools to interact with Supabase for database operations, migrations, and schema changes.
