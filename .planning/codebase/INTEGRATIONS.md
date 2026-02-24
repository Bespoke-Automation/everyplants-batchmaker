# External Integrations

**Analysis Date:** 2026-02-24

## APIs & External Services

**Warehouse Management:**
- **Picqer** - Primary warehouse management system (WMS). Source of truth for orders, products, picklists, shipments, tags, packagings, and users.
  - SDK/Client: Custom HTTP client at `src/lib/picqer/client.ts` (no SDK, raw REST)
  - Auth: HTTP Basic Auth — `PICQER_API_KEY` as username, empty password
  - Base URL: `https://{PICQER_SUBDOMAIN}.picqer.com/api/v1`
  - Rate limiting: Max 3 concurrent requests, exponential backoff on 429, up to 5 retries
  - User-Agent header: `EveryPlants-Batchmaker/2.0`
  - Operations: orders, picklists, batches, shipments, labels, products, tags, packagings, users, comments, customers, purchase orders

**B2B Marketplace:**
- **Floriday** - Digital trading infrastructure for the floriculture sector. Used to push stock batches so buyers can order.
  - SDK/Client: Custom HTTP client at `src/lib/floriday/client.ts` (no SDK, raw REST)
  - Auth: OAuth2 Client Credentials flow, in-memory token cache per environment (staging/live), 5-minute safety margin before expiry
  - Auth implementation: `src/lib/floriday/auth.ts`
  - Config: `src/lib/floriday/config.ts` — reads env vars by environment prefix (`FLORIDAY_STAGING_*` or `FLORIDAY_LIVE_*`)
  - API version: Suppliers API 2025v2
  - Rate limiting: Max 3 concurrent requests, exponential backoff on 429, auto token refresh on 401
  - Scopes: `role:app`, `organization:read`, `catalog:read/write`, `supply:read/write`, `sales-order:read/write`, `fulfillment:read/write`, `webhooks:write`
  - Sync pattern: Sequence-based incremental sync (`syncAll()` in `src/lib/floriday/client.ts`)
  - Operations: trade items sync, supply lines, stock batches, sales orders, fulfillment orders, organizations, warehouses, media upload

**Background Jobs:**
- **Inngest** - Event-driven background job processing for single order batch processing
  - Client: `src/inngest/client.ts`
  - Functions: `src/inngest/functions/processSingleOrderBatch.ts`
  - Served at: `src/app/api/inngest/route.ts`
  - Event: `batch/process.requested` → processes shipment labels with step-based checkpointing, 3 retries
  - Auth: `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`

## Data Storage

**Databases:**
- **Supabase (Primary)** - PostgreSQL database for all application state
  - Connection env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Client: `src/lib/supabase/client.ts` — `@supabase/supabase-js`, `persistSession: false`, `cache: 'no-store'`
  - Schema: All tables in `batchmaker` schema (not `public`). Always use `.schema('batchmaker').from(...)`
  - Helper modules: 16 modules in `src/lib/supabase/` (one per domain area)

- **Supabase (Facturatie/Invoicing)** - Secondary Supabase project for invoicing data
  - Connection env vars: `FACTURATIE_SUPABASE_URL`, `FACTURATIE_SUPABASE_ANON_KEY`
  - Client: `src/lib/supabase/facturatieClient.ts` — singleton pattern, same options as primary

**File Storage:**
- **Supabase Storage** — Storage bucket `shipment-labels` for shipping label PDFs
  - Accessed via primary Supabase client
  - Files organized by batch ID: `{batchId}/{filename}.pdf`
  - Used for individual label PDFs and combined `combined_labels.pdf`

**Caching:**
- In-memory order cache: 30-second cache in Next.js API route for Picqer orders (not a library, handled at route level)
- In-memory Floriday token cache: per-environment cache in `src/lib/floriday/auth.ts`

## Authentication & Identity

**App Auth:**
- Custom cookie-based auth via Next.js middleware (`src/middleware.ts`)
- Validates `auth` cookie value against `APP_PASSWORD` env var
- Login endpoint: `POST /api/auth`
- All UI routes protected; `/api/*` routes pass through without auth check

**No user authentication** — single shared password for the entire operations team.

## Monitoring & Observability

**Error Tracking:**
- Not detected — no Sentry, Datadog, or similar service configured

**Logs:**
- `console.log` / `console.error` throughout all API routes and service files
- No structured logging library

## CI/CD & Deployment

**Hosting:**
- Not explicitly configured — Next.js-compatible (Vercel or self-hosted likely)

**CI Pipeline:**
- Not detected — no GitHub Actions, CircleCI, or similar config files found

## Webhooks & Callbacks

**Incoming:**
- `POST /api/floriday/webhooks` (`src/app/api/floriday/webhooks/route.ts`) — Receives Floriday sales order events. Payload contains `aggregateId` (salesOrderId). Returns HTTP 200 always (to prevent Floriday retries on error).

**Outgoing:**
- **Grive webhook** (hardcoded) — `https://everyplants.grive-dev.com/webhook/ba6eff16-76e9-48d6-bb97-20e4f02fc289`
  - Triggered after batch creation in Picqer (`src/app/api/batches/create/route.ts`)
  - Payload: `{ picklists, filter, batchid }`
  - Non-blocking: failure does not fail batch creation

- **n8n webhook** (configurable) — `N8N_BATCH_WEBHOOK_URL` env var
  - Triggered after successful single-order batch processing in Inngest function (`src/inngest/functions/processSingleOrderBatch.ts`) and API route (`src/app/api/single-orders/batch/[batchId]/process/route.ts`)
  - Payload: `{ batchId, totalOrders, successfulShipments, failedShipments, combinedPdfUrl, picqerBatchIds }`
  - Optional: only fires if env var is set and at least one shipment succeeded

## Environment Configuration

**Required env vars:**
```
# App
APP_PASSWORD                          # Single shared login password

# Supabase (primary - batchmaker)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# Supabase (secondary - facturatie)
FACTURATIE_SUPABASE_URL
FACTURATIE_SUPABASE_ANON_KEY

# Picqer
PICQER_SUBDOMAIN
PICQER_API_KEY
PICQER_FIELD_POTMAAT=5768
PICQER_FIELD_PLANTHOOGTE=5769
PICQER_FIELD_PRODUCTTYPE=5770
PICQER_FIELD_BREEKBAAR=5771
PICQER_FIELD_MIXABLE=5772
PICQER_FIELD_ALTERNATIEVE_SKU=4875

# Floriday (environment toggle: staging or live)
FLORIDAY_ENV=staging                  # or "live"
FLORIDAY_STAGING_API_BASE_URL
FLORIDAY_STAGING_AUTH_URL
FLORIDAY_STAGING_CLIENT_ID
FLORIDAY_STAGING_CLIENT_SECRET
FLORIDAY_STAGING_API_KEY
FLORIDAY_LIVE_API_BASE_URL
FLORIDAY_LIVE_AUTH_URL
FLORIDAY_LIVE_CLIENT_ID
FLORIDAY_LIVE_CLIENT_SECRET
FLORIDAY_LIVE_API_KEY

# Inngest
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY

# Webhooks (optional)
N8N_BATCH_WEBHOOK_URL
```

**Secrets location:**
- `.env.local` file at project root (gitignored)
- All secrets accessed via `process.env` — never hardcoded except the Grive webhook URL in `src/app/api/batches/create/route.ts` (line 50)

---

*Integration audit: 2026-02-24*
