-- Add image_url column to product_attributes for product photos
ALTER TABLE batchmaker.product_attributes
ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT NULL;
