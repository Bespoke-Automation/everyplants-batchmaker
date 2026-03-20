-- Migration: Box capacities table
-- Created: 2026-03-20
-- Description: Defines how many of each shipping unit type fit in each packaging (box)

-- =============================================================================
-- 1. box_capacities
-- =============================================================================
CREATE TABLE batchmaker.box_capacities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packaging_id UUID NOT NULL
        REFERENCES batchmaker.packagings(id) ON DELETE CASCADE,
    shipping_unit_id UUID NOT NULL
        REFERENCES batchmaker.shipping_units(id) ON DELETE CASCADE,
    max_quantity INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_box_capacities_packaging_shipping_unit
        UNIQUE (packaging_id, shipping_unit_id)
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX idx_box_capacities_packaging_id
    ON batchmaker.box_capacities (packaging_id);

CREATE INDEX idx_box_capacities_shipping_unit_id
    ON batchmaker.box_capacities (shipping_unit_id);

-- =============================================================================
-- Apply updated_at trigger
-- =============================================================================
CREATE TRIGGER trg_box_capacities_updated_at
    BEFORE UPDATE ON batchmaker.box_capacities
    FOR EACH ROW
    EXECUTE FUNCTION batchmaker.set_updated_at();
