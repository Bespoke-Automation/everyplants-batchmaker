-- Add default_packaging_id to product_attributes for single-SKU order packaging bypass
ALTER TABLE batchmaker.product_attributes
  ADD COLUMN default_packaging_id UUID REFERENCES batchmaker.packagings(id) ON DELETE SET NULL DEFAULT NULL;

COMMENT ON COLUMN batchmaker.product_attributes.default_packaging_id IS
  'Default packaging for single-SKU orders. When set, bypasses compartment rules for orders with only this product.';
