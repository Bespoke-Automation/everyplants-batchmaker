-- Migration: Verpakkingsmodule tables
-- Created: 2026-02-10
-- Description: Creates packing session tables and tag-packaging mapping for the verpakkingsmodule

-- Ensure batchmaker schema exists
CREATE SCHEMA IF NOT EXISTS batchmaker;

-- =============================================================================
-- 1. packing_sessions
-- =============================================================================
CREATE TABLE batchmaker.packing_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picklist_id INTEGER NOT NULL,               -- Picqer idpicklist
    picklistid TEXT,                             -- Picqer picklistid (e.g. P2025-xxxxx)
    order_id INTEGER,
    order_reference TEXT,
    retailer TEXT,
    delivery_country TEXT,
    assigned_to INTEGER NOT NULL,               -- Picqer iduser
    assigned_to_name TEXT NOT NULL,             -- Worker display name
    status TEXT NOT NULL DEFAULT 'claimed'
        CHECK (status IN ('claimed', 'assigned', 'packing', 'shipping', 'completed', 'failed')),
    locked_at TIMESTAMPTZ DEFAULT NOW(),
    lock_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes'),
    completed_at TIMESTAMPTZ,
    total_products INTEGER DEFAULT 0,
    total_boxes INTEGER DEFAULT 0,
    combined_pdf_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prevent two workers from claiming the same active picklist
CREATE UNIQUE INDEX uq_packing_sessions_active_picklist
    ON batchmaker.packing_sessions (picklist_id)
    WHERE status NOT IN ('completed', 'failed');

-- =============================================================================
-- 2. packing_session_boxes
-- =============================================================================
CREATE TABLE batchmaker.packing_session_boxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL
        REFERENCES batchmaker.packing_sessions(id) ON DELETE CASCADE,
    picqer_packaging_id INTEGER,
    packaging_name TEXT NOT NULL,
    packaging_barcode TEXT,
    weight INTEGER DEFAULT 0,                   -- grams
    shipment_id INTEGER,                        -- Picqer idshipment
    tracking_code TEXT,
    label_url TEXT,                              -- Supabase Storage path
    shipping_provider_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'open', 'closed', 'shipment_created', 'label_fetched', 'shipping', 'shipped', 'error')),
    error_message TEXT,
    box_index INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. packing_session_products
-- =============================================================================
CREATE TABLE batchmaker.packing_session_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL
        REFERENCES batchmaker.packing_sessions(id) ON DELETE CASCADE,
    box_id UUID NOT NULL
        REFERENCES batchmaker.packing_session_boxes(id) ON DELETE CASCADE,
    picqer_product_id INTEGER NOT NULL,
    productcode TEXT NOT NULL,
    product_name TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 1,
    weight_per_unit INTEGER DEFAULT 0,          -- grams
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 4. tag_packaging_map
-- =============================================================================
CREATE TABLE batchmaker.tag_packaging_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_title TEXT NOT NULL UNIQUE,
    picqer_packaging_id INTEGER NOT NULL,
    packaging_name TEXT NOT NULL,
    priority INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX idx_packing_sessions_assigned_to ON batchmaker.packing_sessions (assigned_to);
CREATE INDEX idx_packing_sessions_status ON batchmaker.packing_sessions (status);
CREATE INDEX idx_packing_sessions_picklist_id ON batchmaker.packing_sessions (picklist_id);

CREATE INDEX idx_packing_session_boxes_session_id ON batchmaker.packing_session_boxes (session_id);

CREATE INDEX idx_packing_session_products_session_id ON batchmaker.packing_session_products (session_id);
CREATE INDEX idx_packing_session_products_box_id ON batchmaker.packing_session_products (box_id);

-- =============================================================================
-- updated_at trigger function (create if not exists)
-- =============================================================================
CREATE OR REPLACE FUNCTION batchmaker.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Apply updated_at triggers
-- =============================================================================
CREATE TRIGGER trg_packing_sessions_updated_at
    BEFORE UPDATE ON batchmaker.packing_sessions
    FOR EACH ROW
    EXECUTE FUNCTION batchmaker.set_updated_at();

CREATE TRIGGER trg_packing_session_boxes_updated_at
    BEFORE UPDATE ON batchmaker.packing_session_boxes
    FOR EACH ROW
    EXECUTE FUNCTION batchmaker.set_updated_at();

CREATE TRIGGER trg_tag_packaging_map_updated_at
    BEFORE UPDATE ON batchmaker.tag_packaging_map
    FOR EACH ROW
    EXECUTE FUNCTION batchmaker.set_updated_at();
