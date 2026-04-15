-- ============================================================================
-- Packing Observations — Fase 1 van engine-simplification
-- ============================================================================
-- Doel: elke voltooide doos registreert (fingerprint, packaging) -> count.
-- Fingerprint is land-onafhankelijk en gebruikt uitsluitend "core" producten
-- (flyers/accessoires/platen worden vooraf gefilterd via isAccompanying()).
--
-- De nieuwe engine (fase 2+) leest deze counts om dominante dozen per
-- product-combinatie te vinden. Zie:
--   _bmad-output/planning-artifacts/engine-simplification-migration.md
--   _bmad-output/planning-artifacts/simple-advice-poc.ts
-- ============================================================================

CREATE TABLE batchmaker.packing_observations (
    fingerprint TEXT NOT NULL,
    packaging_id UUID NOT NULL REFERENCES batchmaker.packagings(id) ON DELETE CASCADE,
    count INTEGER NOT NULL DEFAULT 1,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (fingerprint, packaging_id)
);

CREATE INDEX packing_observations_fingerprint_idx
    ON batchmaker.packing_observations (fingerprint);

CREATE INDEX packing_observations_last_seen_idx
    ON batchmaker.packing_observations (last_seen_at DESC);

COMMENT ON TABLE batchmaker.packing_observations IS
    'Land-onafhankelijke telling van (productcode-fingerprint, packaging) voor de simpele engine. Fase 1 — wordt gevuld door tryCompleteSession en backfill-script.';

COMMENT ON COLUMN batchmaker.packing_observations.fingerprint IS
    'Productcode-only fingerprint (geen land, geen shipping unit). Format: "productcode:qty|..." alfabetisch gesorteerd op productcode. Accompanying items (flyers, kaartjes, platen) zijn eruit gefilterd.';

-- ============================================================================
-- Atomic increment RPC — Supabase .upsert() doet standaard een replace, niet
-- een increment. Deze function garandeert dat concurrent completions correct
-- optellen (Postgres ON CONFLICT is atomair, geen extra locks nodig).
-- ============================================================================

CREATE OR REPLACE FUNCTION batchmaker.increment_packing_observation(
    p_fingerprint TEXT,
    p_packaging_id UUID
) RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
AS $$
    INSERT INTO batchmaker.packing_observations (fingerprint, packaging_id, count, last_seen_at)
    VALUES (p_fingerprint, p_packaging_id, 1, NOW())
    ON CONFLICT (fingerprint, packaging_id)
    DO UPDATE SET
        count = packing_observations.count + 1,
        last_seen_at = EXCLUDED.last_seen_at;
$$;

COMMENT ON FUNCTION batchmaker.increment_packing_observation IS
    'Atomair increment van een observation. Gebruik vanuit recordPackingObservations() na sessie-completion.';
