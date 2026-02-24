# Codebase Concerns

**Analysis Date:** 2026-02-24

---

## Tech Debt

**Module-level mutable state in serverless environment:**
- Issue: Rate limiting concurrency state (`activeRequests`, `requestQueue`) is stored in module-level variables in both `src/lib/picqer/client.ts` (line 22-23) and `src/lib/floriday/client.ts` (line 31-32). In a serverless/edge environment these variables reset per cold start, making the concurrency limiter ineffective under load. The Floriday OAuth token cache (`src/lib/floriday/auth.ts` lines 34-37) and the Floriday warehouse ID cache (`src/lib/floriday/push-batch-service.ts` lines 41-53) share the same problem.
- Files: `src/lib/picqer/client.ts`, `src/lib/floriday/client.ts`, `src/lib/floriday/auth.ts`, `src/lib/floriday/push-batch-service.ts`, `src/lib/floriday/sync/order-sync.ts`
- Impact: Rate limit protection is not reliable across concurrent Lambda/edge invocations. Token and warehouse caches reset on cold starts, causing extra auth calls.
- Fix approach: Move shared state to a durable store (e.g. Supabase table or Redis) for true multi-instance safety, or accept the limitation for a single-instance deployment.

**Dual naming of packing session IDs (`picklist_id` vs `picklistid`):**
- Issue: `packing_sessions` table stores both `picklist_id` (integer, numeric Picqer ID) and `picklistid` (string, human-readable ID like "PL-12345"). The `createPackingSession` function in `src/lib/supabase/packingSessions.ts` (line 117) stores both. The `transformSession` function in `src/hooks/usePackingSession.ts` must handle both `raw.picklist_id` and `raw.picklistId` to stay compatible. This pattern adds complexity without clear benefit.
- Files: `src/lib/supabase/packingSessions.ts`, `src/hooks/usePackingSession.ts`
- Impact: Increased mapping boilerplate. Risk of divergence if one field is updated but not the other.
- Fix approach: Pick one canonical identifier and migrate. The integer `picklist_id` is sufficient; the string `picklistid` is redundant.

**`any` typed transform functions in usePackingSession:**
- Issue: Three transform functions (`transformProduct`, `transformBox`, `transformSession`) use `any` typed parameters (lines 49, 62, 84 in `src/hooks/usePackingSession.ts`), suppressed with `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. The reason is that the hook must handle both camelCase API responses and snake_case Supabase rows.
- Files: `src/hooks/usePackingSession.ts`
- Impact: No compile-time safety for the most critical state transformation in the verpakkingsmodule.
- Fix approach: Define a union type or a discriminated union for raw API responses vs Supabase rows. Use strict typing in transforms.

**Hardcoded Picqer entity IDs in Floriday order mapper:**
- Issue: Three Picqer IDs are hardcoded as constants in `src/lib/floriday/mappers/order-mapper.ts`: `PICQER_TEMPLATE_ID = 9102`, `DANISH_TROLLEY.idproduct = 38535312`, `AUCTION_TROLLEY.idproduct = 38535557`. These are live Picqer environment IDs. If the Picqer environment changes (e.g., a new account), these will silently map orders to wrong templates/products.
- Files: `src/lib/floriday/mappers/order-mapper.ts`
- Impact: Silent mismatch in Floriday → Picqer order creation if IDs change.
- Fix approach: Move these to environment variables (`PICQER_TEMPLATE_FLORIDAY`, `PICQER_PRODUCT_DANISH_TROLLEY`, `PICQER_PRODUCT_AUCTION_TROLLEY`) or to a Supabase config table.

**Supabase anon key used for service-role operations:**
- Issue: `src/app/api/sync-excluded-products/route.ts` (line 8) falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` if `SUPABASE_SERVICE_ROLE_KEY` is absent. All Supabase operations in the codebase use only the anon key (no row-level security is enforced), which means the anon key effectively acts as a service key.
- Files: `src/lib/supabase/client.ts`, `src/app/api/sync-excluded-products/route.ts`
- Impact: No row-level security provides any protection. If the anon key leaks (it is `NEXT_PUBLIC_`), all database data is accessible.
- Fix approach: Enable Supabase RLS on all `batchmaker` schema tables. Use a server-only service role key for write operations. Rename client usage to `SUPABASE_SERVICE_ROLE_KEY` on the server.

**mock data file in production codebase:**
- Issue: `src/data/mockVerpakkingData.ts` (456 lines) contains a full set of mock packaging types and picklists with external Unsplash image URLs. It is only exported but never imported anywhere in the production code (`grep` finds no usages). It was likely used during early development.
- Files: `src/data/mockVerpakkingData.ts`
- Impact: Dead code adds confusion. Unsplash URLs in source code will load images from an external domain if ever used accidentally.
- Fix approach: Delete the file.

**Debug log statements left in production routes:**
- Issue: There are 576 `console.log/warn/error` calls across 112 files, including active debug logs in `src/app/api/orders/route.ts` (lines 14-20: "Debug: Log first order to see delivery fields") and throughout `src/lib/picqer/client.ts` (171 calls). These are sent to production logs verbatim, including partial JSON of order data.
- Files: `src/app/api/orders/route.ts`, `src/lib/picqer/client.ts`, and ~110 other files
- Impact: Noisy logs make debugging harder. Log volume could exceed hosting quotas. Partial order data may appear in logs.
- Fix approach: Replace debug `console.log` calls with a log-level abstraction (e.g., only log when `LOG_LEVEL=debug`). Remove the explicit "Debug:" comment in `orders/route.ts`.

---

## Known Bugs

**Floriday webhook processes fulfillment orders from sequence 0:**
- Symptoms: Every Floriday webhook call fetches ALL fulfillment orders from the beginning (`syncFulfillmentOrders(0)` in `src/app/api/floriday/webhooks/route.ts` line 35). This is marked with a `// TODO: track FO sequence in webhook context` comment.
- Files: `src/app/api/floriday/webhooks/route.ts`
- Trigger: Any Floriday webhook event (e.g. new sales order).
- Workaround: None. The webhook still processes the correct order, but every call re-fetches all historical fulfillment orders.

**Multicollo shipment parcel mapping is positional (fragile):**
- Issue: In `src/app/api/verpakking/sessions/[id]/ship-all/route.ts` (lines 159-161), each parcel from the Picqer multicollo response is mapped to a box by array index (`shipmentParcels[i]`). If Picqer returns parcels in a different order than submitted, labels will be applied to the wrong box.
- Files: `src/app/api/verpakking/sessions/[id]/ship-all/route.ts`
- Trigger: Multicollo shipment with 2+ boxes where Picqer parcel order differs from submission order.
- Workaround: Single-box shipments are unaffected.

---

## Security Considerations

**API routes have no authentication:**
- Risk: All routes under `/api/*` are excluded from auth middleware (`src/middleware.ts` lines 11-13). Any caller with network access to the deployed app can invoke Picqer, Supabase, and Floriday operations without any credential.
- Files: `src/middleware.ts`, all `src/app/api/` routes
- Current mitigation: The app is presumably deployed on an internal/private network or requires VPN access. Cookie auth only protects page routes.
- Recommendations: Add an API middleware layer that validates the `auth` cookie or a static API key header for all `/api/*` calls. At minimum, protect mutation endpoints (POST/PUT/DELETE).

**Floriday webhook has no signature verification:**
- Risk: `src/app/api/floriday/webhooks/route.ts` accepts any POST request claiming to be a Floriday webhook with no signature check. An attacker can trigger order creation in Picqer by sending a crafted payload with a valid `aggregateId`.
- Files: `src/app/api/floriday/webhooks/route.ts`
- Current mitigation: None. The endpoint returns HTTP 200 even on errors.
- Recommendations: Verify a shared secret or HMAC signature from Floriday in the request headers before processing. Block requests that fail verification.

**Supabase anon key exposed to browser:**
- Risk: `NEXT_PUBLIC_SUPABASE_ANON_KEY` is bundled into the client-side JavaScript. The `batchmaker` schema has no row-level security enforced (all queries use the anon client). Anyone who inspects the page source can extract the key and query the database directly.
- Files: `src/lib/supabase/client.ts`
- Current mitigation: The app is internal-only.
- Recommendations: Enable Supabase RLS policies on all `batchmaker` and `floriday` schema tables. Restrict anon key to read-only or no direct access. Move all mutations to server routes with a service role key.

---

## Performance Bottlenecks

**Full order fetch on every page load (no server-side cache):**
- Problem: `GET /api/orders` calls `fetchAllOrders()` in `src/lib/picqer/client.ts` which paginates through up to 3000 orders (30 sequential API calls at 100 orders each). There is no server-side caching layer — `cache: 'no-store'` is set explicitly. With a 30-second safety limit hardcoded, a large order backlog will always take ~30 seconds.
- Files: `src/app/api/orders/route.ts`, `src/lib/picqer/client.ts`
- Cause: Design choice to always fetch fresh data. The in-memory "30s cache" mentioned in CLAUDE.md is not present in the current code.
- Improvement path: Implement a short-lived server-side cache (e.g. 30-60s) using Next.js `unstable_cache` or an in-memory LRU cache. Avoid fetching more than the most recent offset unless explicitly paginating.

**Packaging engine makes multiple sequential DB round-trips per order:**
- Problem: `classifyOrderProducts` in `src/lib/engine/packagingEngine.ts` makes at minimum 4 sequential Supabase queries per order calculation: fetch product attributes, fetch shipping unit names, fetch composition parts, then re-fetch each on-demand synced product. For an order with unclassified products, it also makes serial Picqer API calls per product (batched 5 at a time), each requiring classification and re-fetch.
- Files: `src/lib/engine/packagingEngine.ts`
- Cause: On-demand sync design. Each unclassified product triggers a Picqer fetch + DB upsert + re-read.
- Improvement path: Pre-warm the product attribute cache as a background task. Accept stale classification for the current request and queue re-classification async.

**Polling every 5 seconds across all active verpakking views:**
- Problem: `useBatchQueue`, `useBatchSession`, and `usePicklistQueue` hooks all poll their respective endpoints at 5-second intervals (`POLL_INTERVAL = 5000`). With multiple medewerkers active, this generates constant background load even when nothing has changed.
- Files: `src/hooks/useBatchQueue.ts`, `src/hooks/useBatchSession.ts`, `src/hooks/usePicklistQueue.ts`
- Cause: No real-time subscription mechanism; polling is the only option with the current setup.
- Improvement path: Use Supabase Realtime subscriptions (`supabase.channel().on('postgres_changes', ...)`) to replace polling. This reduces load to event-driven updates only.

---

## Fragile Areas

**Session lock expiry relies on client-side refresh:**
- Files: `src/lib/supabase/packingSessions.ts`, `src/hooks/usePackingSession.ts`
- Why fragile: The 30-minute packing session lock in `lock_expires_at` is only refreshed by an active client. If a medewerker closes the browser mid-session, the lock stays until it expires. No background job reaps expired locks.
- Safe modification: When implementing any lock-related logic, test the full lock → expire → re-claim flow. Do not assume a session is still valid without checking `lock_expires_at > now()`.
- Test coverage: None (no test files exist in `src/`).

**Engine tag-writing depends on pre-existing Picqer tags:**
- Files: `src/lib/engine/packagingEngine.ts` (lines 1165-1169)
- Why fragile: `applyTags` silently skips writing a tag if it does not yet exist in Picqer (`Tag "${tagName}" does not exist in Picqer — skipping`). There is no error raised, no fallback, and no alert. If the tag is not created in Picqer first, the engine appears to succeed but no tag is written to the order.
- Safe modification: Always verify tag setup in Picqer when adding new packaging types. The silent skip makes it hard to detect misconfiguration.
- Test coverage: None.

**VerpakkingsClient is a single 2277-line component:**
- Files: `src/components/verpakking/VerpakkingsClient.tsx`
- Why fragile: All packing session UI, drag-and-drop logic, barcode scanning, engine advice display, shipping, and comments are in one file. Adding features requires navigating 2277 lines and risks side effects across unrelated features.
- Safe modification: Changes to any sub-feature (e.g. engine advice display) require full understanding of the component's internal state. Test manually against barcode scan, multi-box, and single-box flows after any change.
- Test coverage: None.

**BatchOverview is a single 1595-line component:**
- Files: `src/components/verpakking/BatchOverview.tsx`
- Why fragile: Combines batch-level overview, picklist queue, product scanning, and comment management. Has two `// eslint-disable-next-line @next/next/no-img-element` suppressions indicating workarounds.
- Safe modification: Same risk as VerpakkingsClient. Test the full batch → picklist → start-packing flow after any change.
- Test coverage: None.

**Floriday sync sequence persistence:**
- Files: `src/lib/floriday/sync/trade-item-sync.ts`, `src/lib/floriday/sync/order-sync.ts`
- Why fragile: The sequence-based Floriday sync loop can run for an extended time. If interrupted mid-sync (timeout, crash), the stored sequence number may not reflect what was actually processed, causing either re-processing or gaps.
- Safe modification: Any change to sync loop termination conditions or sequence storage must handle the case where `maximumSequenceNumber` updates while the loop is running.
- Test coverage: None.

---

## Scaling Limits

**Picqer order fetch hard limit:**
- Current capacity: Up to 3000 orders per `/api/orders` call (30 × 100-order pages).
- Limit: `src/lib/picqer/client.ts` line 136: `if (offset >= 3000) break`. Orders beyond 3000 will never appear in the batchmaker.
- Scaling path: Increase the limit, or implement incremental fetching filtered by creation date to avoid re-fetching old orders.

**Product attribute bulk sync hard limit:**
- Current capacity: Up to 10,000 products per bulk sync run.
- Limit: `src/lib/supabase/productAttributes.ts` line 198: `if (offset >= 10000) break`.
- Scaling path: For catalogues over 10,000 products, the sync will silently stop. Add logging when the limit is hit and implement cursor-based pagination.

---

## Dependencies at Risk

**No input validation library:**
- Risk: No Zod, Joi, or similar schema validation library is used in API routes. All validation is ad-hoc `if (!field)` checks. Only 8 files contain any form of validation across ~80 API endpoints.
- Impact: Malformed requests can reach database calls or external API calls and produce cryptic errors or unexpected data states.
- Migration plan: Add Zod to API route handlers, starting with mutation endpoints (POST/PUT/DELETE). Validate request body shape before any DB or Picqer calls.

---

## Test Coverage Gaps

**Zero application test files:**
- What's not tested: Entire codebase. No `*.test.*` or `*.spec.*` files exist under `src/`. No test runner is configured.
- Files: All files under `src/`
- Risk: Any logic change (packaging engine, transform functions, Floriday mappers, session lock logic) can break silently. There is no safety net for refactoring.
- Priority: High — especially for the packaging engine (`src/lib/engine/packagingEngine.ts`), order transform (`src/lib/picqer/transform.ts`), and Floriday order mapper (`src/lib/floriday/mappers/order-mapper.ts`).

**Packaging engine edge cases not covered:**
- What's not tested: Multi-box bin-packing, non-mixable product isolation, composition decomposition, weight-exceeded logic, ALTERNATIEF operator in compartment rules.
- Files: `src/lib/engine/packagingEngine.ts`
- Risk: A rule configuration change or Picqer data edge case can silently produce wrong box advice, which only manifests as a physical packing error in the warehouse.
- Priority: High.

**Floriday order mapper not covered:**
- What's not tested: Load carrier product mapping, warehouse GLN resolution, delivery day extraction, the `null` return paths in `src/lib/floriday/mappers/order-mapper.ts` and `src/lib/floriday/mappers/product-resolver.ts`.
- Files: `src/lib/floriday/mappers/order-mapper.ts`, `src/lib/floriday/mappers/product-resolver.ts`, `src/lib/floriday/mappers/customer-resolver.ts`
- Risk: Incorrect orders created in Picqer from Floriday sales orders.
- Priority: High.

---

*Concerns audit: 2026-02-24*
