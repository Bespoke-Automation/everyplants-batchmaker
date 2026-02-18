-- Add image_url column to packagings table
ALTER TABLE batchmaker.packagings
ADD COLUMN IF NOT EXISTS image_url TEXT NULL;

-- Create storage bucket for packaging images (public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('packaging-images', 'packaging-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to packaging images
CREATE POLICY "Public read access for packaging images"
ON storage.objects FOR SELECT
USING (bucket_id = 'packaging-images');

-- Allow authenticated and anon users to upload packaging images
CREATE POLICY "Allow upload packaging images"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'packaging-images');

-- Allow update (overwrite) of packaging images
CREATE POLICY "Allow update packaging images"
ON storage.objects FOR UPDATE
USING (bucket_id = 'packaging-images');

-- Allow delete of packaging images
CREATE POLICY "Allow delete packaging images"
ON storage.objects FOR DELETE
USING (bucket_id = 'packaging-images');
