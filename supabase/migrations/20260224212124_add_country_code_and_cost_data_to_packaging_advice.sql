-- Add country_code and cost_data_available to packaging_advice
ALTER TABLE batchmaker.packaging_advice
  ADD COLUMN IF NOT EXISTS country_code text,
  ADD COLUMN IF NOT EXISTS cost_data_available boolean DEFAULT true;

-- Comment for clarity
COMMENT ON COLUMN batchmaker.packaging_advice.country_code IS 'ISO country code used for this advice calculation (e.g., NL, DE, FR)';
COMMENT ON COLUMN batchmaker.packaging_advice.cost_data_available IS 'Whether transport cost data was available when this advice was calculated';
