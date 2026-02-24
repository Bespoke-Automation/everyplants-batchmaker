-- Picqer Product Index: lokale lookup voor Alternatieve SKU → Picqer product
-- Wordt on-demand gesynchroniseerd wanneer een onbekende SKU binnenkomt.
-- Alleen producten met ingevulde Alternatieve SKU worden opgeslagen.

CREATE TABLE IF NOT EXISTS floriday.picqer_product_index (
  picqer_product_id INTEGER PRIMARY KEY,
  productcode TEXT NOT NULL,
  alt_sku TEXT NOT NULL,
  name TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index op alt_sku voor snelle lookups
CREATE UNIQUE INDEX idx_picqer_product_index_alt_sku ON floriday.picqer_product_index (alt_sku);

-- Index op productcode voor fallback lookups
CREATE INDEX idx_picqer_product_index_productcode ON floriday.picqer_product_index (productcode);
