-- Migration: Capacity feedback table
-- Created: 2026-03-20
-- Description: Captures implicit box capacity knowledge from actual packing sessions

CREATE TABLE batchmaker.capacity_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    packaging_id UUID NOT NULL
        REFERENCES batchmaker.packagings(id) ON DELETE CASCADE,
    shipping_unit_id UUID NOT NULL
        REFERENCES batchmaker.shipping_units(id) ON DELETE CASCADE,
    observed_quantity INTEGER NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'auto_approved', 'approved', 'rejected')),
    last_session_id UUID
        REFERENCES batchmaker.packing_sessions(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    approved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_capacity_feedback_pkg_unit
        UNIQUE (packaging_id, shipping_unit_id)
);

CREATE INDEX idx_capacity_feedback_status
    ON batchmaker.capacity_feedback (status);

CREATE TRIGGER trg_capacity_feedback_updated_at
    BEFORE UPDATE ON batchmaker.capacity_feedback
    FOR EACH ROW
    EXECUTE FUNCTION batchmaker.set_updated_at();

-- Coverage tracking: log when engine gives no advice
CREATE TABLE batchmaker.advice_coverage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id INTEGER NOT NULL,
    picklist_id INTEGER,
    country_code VARCHAR(3),
    confidence VARCHAR(20) NOT NULL, -- full_match, partial_match, no_match
    total_shipping_units INTEGER NOT NULL DEFAULT 0,
    uncovered_unit_ids TEXT[], -- shipping_unit_ids without capacity data
    uncovered_unit_names TEXT[], -- human-readable names
    total_cost NUMERIC(10,2), -- advised total cost (null if no_match)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_advice_coverage_log_confidence
    ON batchmaker.advice_coverage_log (confidence);
CREATE INDEX idx_advice_coverage_log_created
    ON batchmaker.advice_coverage_log (created_at DESC);
