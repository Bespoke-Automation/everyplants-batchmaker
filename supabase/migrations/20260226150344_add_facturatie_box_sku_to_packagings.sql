-- Migration: Add facturatie_box_sku column to packagings table
-- Purpose: Join key between batchmaker packagings and facturatie published_box_costs

-- 1. Add the column
ALTER TABLE batchmaker.packagings
ADD COLUMN IF NOT EXISTS facturatie_box_sku TEXT DEFAULT NULL;

COMMENT ON COLUMN batchmaker.packagings.facturatie_box_sku IS 'Join key to facturatie published_box_costs.box_sku';

-- 2. Seed the 6 known mismatch mappings (barcode != facturatie SKU)
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_950' WHERE barcode = '55_922';
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_922' WHERE barcode = '55_896';
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_923' WHERE barcode = '55_897';
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_926-1' WHERE barcode = '55_1180';
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_1' WHERE barcode = '55_1178';
UPDATE batchmaker.packagings SET facturatie_box_sku = '55_917' WHERE barcode = '55_900';

-- 3. For all other active packagings where barcode exists and is not a mismatch or batchmaker-only,
--    set facturatie_box_sku = barcode (16 same-as-barcode mappings)
UPDATE batchmaker.packagings
SET facturatie_box_sku = barcode
WHERE barcode IS NOT NULL
  AND barcode NOT IN ('55_890', '55_891', '55_1053', '55_922', '55_896', '55_897', '55_1180', '55_1178', '55_900')
  AND facturatie_box_sku IS NULL;

-- 4. Explicitly set NULL for batchmaker-only packagings (no facturatie equivalent)
UPDATE batchmaker.packagings
SET facturatie_box_sku = NULL
WHERE barcode IN ('55_890', '55_891', '55_1053');
