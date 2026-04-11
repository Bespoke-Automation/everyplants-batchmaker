-- Shopify tracking sync — patches Picqer's Shopify integration limitation
-- where only the first shipment per picklist gets pushed as a fulfillment
-- tracking code. For multi-shipment picklists (e.g. plant + pot in separate
-- boxes) the second+ trackings never reach the customer.
--
-- This migration creates:
--   1) shopify_stores — per-retailer store config (credentials in env vars)
--   2) shopify_tracking_sync_log — audit log for sync runs
--
-- The matching code lives in:
--   src/lib/shopify/admin-client.ts
--   src/inngest/functions/syncShopifyTracking.ts

CREATE TABLE IF NOT EXISTS batchmaker.shopify_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_tag text NOT NULL UNIQUE,
  store_domain text NOT NULL,
  env_var_prefix text NOT NULL,
  api_version text NOT NULL DEFAULT '2025-01',
  enabled boolean NOT NULL DEFAULT false,
  tracking_sync_enabled boolean NOT NULL DEFAULT false,
  carrier_override text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE batchmaker.shopify_stores IS
  'Per-retailer Shopify shop config. Tokens themselves live in env vars (env_var_prefix + _ADMIN_TOKEN).';
COMMENT ON COLUMN batchmaker.shopify_stores.retailer_tag IS
  'Must match the Picqer tag title exactly (e.g. Florafy, Green Bubble, Trendyplants)';
COMMENT ON COLUMN batchmaker.shopify_stores.env_var_prefix IS
  'Prefix for env vars. Actual token read from prefix + _ADMIN_TOKEN';

CREATE TABLE IF NOT EXISTS batchmaker.shopify_tracking_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  picqer_order_id bigint NOT NULL,
  picqer_picklist_id bigint NOT NULL,
  retailer_tag text NOT NULL,
  shopify_order_id bigint,
  shopify_fulfillment_id bigint,
  picqer_shipment_ids bigint[] NOT NULL DEFAULT '{}',
  tracking_codes text[] NOT NULL DEFAULT '{}',
  tracking_urls text[] NOT NULL DEFAULT '{}',
  carrier text,
  status text NOT NULL CHECK (status IN ('pending','synced','skipped','failed')),
  skip_reason text,
  error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_sync_log_order
  ON batchmaker.shopify_tracking_sync_log(picqer_order_id);
CREATE INDEX IF NOT EXISTS idx_tracking_sync_log_status_created
  ON batchmaker.shopify_tracking_sync_log(status, created_at DESC);

COMMENT ON TABLE batchmaker.shopify_tracking_sync_log IS
  'Audit log for Shopify tracking code sync. Patches Picqer Shopify sync limitation where only first shipment tracking is pushed.';

-- Seed: 3 retailers, only Florafy initially active
INSERT INTO batchmaker.shopify_stores
  (retailer_tag, store_domain, env_var_prefix, enabled, tracking_sync_enabled, notes)
VALUES
  ('Florafy', 'florafykunstplanten.myshopify.com', 'SHOPIFY_FLORAFY', true, true, 'Initial rollout — active'),
  ('Green Bubble', 'TO_BE_SET.myshopify.com', 'SHOPIFY_GREEN_BUBBLE', false, false, 'Credentials pending'),
  ('Trendyplants', '48a6aa-2.myshopify.com', 'SHOPIFY_TRENDYPLANTS', false, false, 'Credentials pending — not yet activated')
ON CONFLICT (retailer_tag) DO NOTHING;
