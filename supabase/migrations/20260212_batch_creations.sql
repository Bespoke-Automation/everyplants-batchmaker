-- Migration: Batch creation history
-- Created: 2026-02-12
-- Description: Tracks batch creation results for the /batches page

CREATE TABLE batchmaker.batch_creations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    picqer_batch_id INTEGER NOT NULL,
    picklist_count INTEGER NOT NULL,
    pps_filter TEXT NOT NULL CHECK (pps_filter IN ('ja', 'nee')),
    webhook_triggered BOOLEAN DEFAULT false,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_batch_creations_created_at
    ON batchmaker.batch_creations (created_at DESC);
