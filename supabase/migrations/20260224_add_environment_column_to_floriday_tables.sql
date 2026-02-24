-- ══════════════════════════════════════════════════════════════
-- Migration: Add environment column to all floriday tables
-- ══════════════════════════════════════════════════════════════
-- Adds an 'environment' column (TEXT NOT NULL DEFAULT 'staging') to every
-- table in the floriday schema and updates unique constraints to include
-- environment, so the same data can coexist for staging and production.

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. trade_items
--    Current PK: trade_item_id (uuid) — must become composite unique
--    We add an id serial column as new PK.
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.trade_items
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

-- Drop old PK and add new auto-increment PK
ALTER TABLE floriday.trade_items
  DROP CONSTRAINT trade_items_pkey;

ALTER TABLE floriday.trade_items
  ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY;

ALTER TABLE floriday.trade_items
  ADD CONSTRAINT trade_items_pkey PRIMARY KEY (id);

-- New unique constraint on (trade_item_id, environment)
ALTER TABLE floriday.trade_items
  ADD CONSTRAINT uq_ti_trade_item_env UNIQUE (trade_item_id, environment);

-- ────────────────────────────────────────────────────────────
-- 2. product_mapping
--    Current: uq_pm_floriday UNIQUE (floriday_trade_item_id)
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.product_mapping
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE floriday.product_mapping
  DROP CONSTRAINT uq_pm_floriday;

ALTER TABLE floriday.product_mapping
  ADD CONSTRAINT uq_pm_floriday UNIQUE (floriday_trade_item_id, environment);

-- ────────────────────────────────────────────────────────────
-- 3. sync_state
--    Current: uq_sync_resource UNIQUE (resource_name)
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.sync_state
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE floriday.sync_state
  DROP CONSTRAINT uq_sync_resource;

ALTER TABLE floriday.sync_state
  ADD CONSTRAINT uq_sync_resource UNIQUE (resource_name, environment);

-- ────────────────────────────────────────────────────────────
-- 4. order_mapping
--    Current: uq_om_floriday UNIQUE (floriday_sales_order_id)
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.order_mapping
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE floriday.order_mapping
  DROP CONSTRAINT uq_om_floriday;

ALTER TABLE floriday.order_mapping
  ADD CONSTRAINT uq_om_floriday UNIQUE (floriday_sales_order_id, environment);

-- ────────────────────────────────────────────────────────────
-- 5. warehouse_cache
--    Current PK: gln (text) — must become composite unique
--    We add an id serial column as new PK.
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.warehouse_cache
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE floriday.warehouse_cache
  DROP CONSTRAINT warehouse_cache_pkey;

ALTER TABLE floriday.warehouse_cache
  ADD COLUMN id BIGINT GENERATED ALWAYS AS IDENTITY;

ALTER TABLE floriday.warehouse_cache
  ADD CONSTRAINT warehouse_cache_pkey PRIMARY KEY (id);

-- New unique constraint on (gln, environment)
ALTER TABLE floriday.warehouse_cache
  ADD CONSTRAINT uq_wc_gln_env UNIQUE (gln, environment);

-- ────────────────────────────────────────────────────────────
-- 6. customer_mapping
--    Current: uq_cm_floriday UNIQUE (floriday_organization_id)
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.customer_mapping
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

ALTER TABLE floriday.customer_mapping
  DROP CONSTRAINT uq_cm_floriday;

ALTER TABLE floriday.customer_mapping
  ADD CONSTRAINT uq_cm_floriday UNIQUE (floriday_organization_id, environment);

-- ────────────────────────────────────────────────────────────
-- 7. sync_log
--    No existing unique constraint — just add the column
-- ────────────────────────────────────────────────────────────
ALTER TABLE floriday.sync_log
  ADD COLUMN environment TEXT NOT NULL DEFAULT 'staging';

COMMIT;
