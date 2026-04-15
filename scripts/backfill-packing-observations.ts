/**
 * Backfill batchmaker.packing_observations uit historische voltooide sessies.
 *
 * Doel
 *   Bij het activeren van fase 1 van de engine-simplification moet de nieuwe
 *   tabel `packing_observations` aangevuld worden met alle gedragingen van
 *   workers uit het recente verleden. Zonder backfill start de nieuwe engine
 *   pas na weken voldoende data te hebben.
 *
 * Usage
 *   npx tsx scripts/backfill-packing-observations.ts                 # dry-run (default)
 *   npx tsx scripts/backfill-packing-observations.ts --apply         # additief inserts (ON CONFLICT optellen)
 *   npx tsx scripts/backfill-packing-observations.ts --apply --reset # TRUNCATE eerst, daarna insert (volledig idempotent)
 *   npx tsx scripts/backfill-packing-observations.ts --days 180      # venster aanpassen (default 90)
 *
 * Idempotentie-strategie
 *   Het script aggregeert de complete historie in-memory en schrijft via
 *   upsert weg. De upsert REPLACEt `count` naar de fresh aggregate. Effect:
 *   - Script her-draaien zonder tussentijdse live-writes → idempotent.
 *   - Script draaien WHILE live RPC-increments bijkomen → race: de backfill
 *     overschrijft live-counts. Draai het script dus alleen tijdens de
 *     initial load (vóór `recordPackingObservations` in productie actief is)
 *     of in een dal-uur. Fase 1 van het plan zegt: backfill draaien NA
 *     deploy van de hook — accepteer dat live-events tijdens het draaien
 *     (minuten) mogelijk overschreven worden; na de run lopen ze vanzelf in.
 *   - Met `--reset`: eerst alle bestaande observations wissen. Volledig
 *     schone staat. Gebruik alleen tijdens de allereerste load.
 *
 * Aanpak (per pagina sessies)
 *   1. Lees voltooide sessies in pagina's (max 1000 per fetch).
 *   2. Haal boxes voor die sessies in batches van max 200 ids per `.in()` call
 *      (voorkomt HTTP 431 op lange querystrings).
 *   3. Haal box-producten op, bundel per box.
 *   4. Haal product_attributes op voor alle unieke picqer_product_ids.
 *   5. Resolve picqer_packaging_id (int) → packagings.id (uuid).
 *   6. Per box: filter accompanying → fingerprint → aggregate naar
 *      (fingerprint, packaging_uuid) → count++ in een in-memory Map.
 *   7. Aan het einde: flush de aggregate Map in chunks van 500 naar de DB.
 *
 * Waarom geen RPC per box
 *   De RPC `increment_packing_observation` is ontworpen voor single-call
 *   atomair gedrag tijdens live session-completion (1 event = 1 call).
 *   Bij backfill is één bulk-insert met ON CONFLICT véél efficiënter
 *   (1000x minder roundtrips).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import {
  isAccompanying,
  buildProductcodeFingerprint,
  type AccompanyingAttr,
  type ProductLike,
} from '../src/lib/engine/accompanying'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

// ── CLI args ──────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply')
const RESET = process.argv.includes('--reset')
const daysArg = (() => {
  const idx = process.argv.indexOf('--days')
  if (idx === -1) return 90
  const val = parseInt(process.argv[idx + 1] ?? '', 10)
  return Number.isFinite(val) && val > 0 ? val : 90
})()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY)

// ── Constants ────────────────────────────────────────────────────────

const IN_BATCH_SIZE = 200 // max ids per .in() call — guards against HTTP 431
const SESSION_PAGE_SIZE = 1000 // sessions-per-page fetch
const UPSERT_CHUNK_SIZE = 500 // rows per upsert call

// ── Types ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  status: string
  completed_at: string | null
}

interface BoxRow {
  id: string
  session_id: string
  picqer_packaging_id: number | null
}

interface BoxProductRow {
  box_id: string
  picqer_product_id: number
  productcode: string
  amount: number
}

interface ProductAttrRow {
  picqer_product_id: number
  product_type: string | null
  classification_status: string | null
}

interface PackagingRow {
  id: string
  idpackaging: number | null
}

// ── Helpers ──────────────────────────────────────────────────────────

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchInBatches<T>(
  ids: readonly (string | number)[],
  fetcher: (batch: (string | number)[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = []
  for (const batch of chunk(ids, IN_BATCH_SIZE)) {
    out.push(...(await fetcher(batch as (string | number)[])))
  }
  return out
}

// ── Main ────────────────────────────────────────────────────────────

async function run() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysArg)
  const cutoffIso = cutoff.toISOString()

  console.log('─'.repeat(72))
  console.log(`Backfill packing_observations`)
  console.log(`  mode:        ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  console.log(`  reset:       ${RESET ? 'YES (TRUNCATE first)' : 'no'}`)
  console.log(`  window:      last ${daysArg} days (since ${cutoffIso})`)
  console.log('─'.repeat(72))

  // Phase 0 — optional reset
  if (RESET && APPLY) {
    console.log('\n[reset] TRUNCATE batchmaker.packing_observations ...')
    // No SQL-exec available via supabase-js, so we use DELETE. That keeps
    // the indexes and is idempotent enough for a one-shot backfill.
    const { error } = await supabase
      .schema('batchmaker')
      .from('packing_observations')
      .delete()
      .neq('fingerprint', '___never_matches___')
    if (error) {
      console.error('[reset] Failed to delete:', error)
      process.exit(1)
    }
    console.log('[reset] done')
  }

  // Phase 1 — fetch all completed sessions in window (paginated)
  const sessionIds: string[] = []
  let page = 0
  while (true) {
    const from = page * SESSION_PAGE_SIZE
    const to = from + SESSION_PAGE_SIZE - 1
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_sessions')
      .select('id, status, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', cutoffIso)
      .order('completed_at', { ascending: true })
      .range(from, to)
    if (error) {
      console.error('[sessions] Fetch failed:', error)
      process.exit(1)
    }
    const rows = (data ?? []) as SessionRow[]
    sessionIds.push(...rows.map(r => r.id))
    if (rows.length < SESSION_PAGE_SIZE) break
    page++
  }
  console.log(`\n[sessions] completed in window: ${sessionIds.length}`)
  if (sessionIds.length === 0) {
    console.log('Nothing to backfill. Exiting.')
    return
  }

  // Phase 2 — load boxes for those sessions
  const boxes = await fetchInBatches<BoxRow>(sessionIds, async batch => {
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_session_boxes')
      .select('id, session_id, picqer_packaging_id')
      .in('session_id', batch as string[])
    if (error) throw error
    return (data ?? []) as BoxRow[]
  })
  console.log(`[boxes] rows: ${boxes.length}`)

  // Filter: only boxes with a real packaging id
  const boxesWithPackaging = boxes.filter(
    b => b.picqer_packaging_id != null && b.picqer_packaging_id > 0,
  )
  console.log(`[boxes] with packaging: ${boxesWithPackaging.length}`)

  const boxIds = boxesWithPackaging.map(b => b.id)
  if (boxIds.length === 0) {
    console.log('No boxes with packaging — nothing to backfill.')
    return
  }

  // Phase 3 — load products per box
  const products = await fetchInBatches<BoxProductRow>(boxIds, async batch => {
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packing_session_products')
      .select('box_id, picqer_product_id, productcode, amount')
      .in('box_id', batch as string[])
    if (error) throw error
    return (data ?? []) as BoxProductRow[]
  })
  console.log(`[products] rows: ${products.length}`)

  // Phase 4 — load product_attributes for all unique picqer_product_ids
  const uniqueProductIds = [...new Set(products.map(p => p.picqer_product_id))]
  const attrByProductId = new Map<number, AccompanyingAttr>()
  if (uniqueProductIds.length > 0) {
    const attrs = await fetchInBatches<ProductAttrRow>(
      uniqueProductIds,
      async batch => {
        const { data, error } = await supabase
          .schema('batchmaker')
          .from('product_attributes')
          .select('picqer_product_id, product_type, classification_status')
          .in('picqer_product_id', batch as number[])
        if (error) throw error
        return (data ?? []) as ProductAttrRow[]
      },
    )
    for (const a of attrs) {
      attrByProductId.set(a.picqer_product_id, {
        product_type: a.product_type,
        classification_status: a.classification_status,
      })
    }
  }
  console.log(`[attrs] mapped: ${attrByProductId.size}`)

  // Phase 5 — resolve picqer_packaging_id → uuid
  const uniquePicqerPackagingIds = [
    ...new Set(
      boxesWithPackaging
        .map(b => b.picqer_packaging_id as number),
    ),
  ]
  const packagingUuidByPicqerId = new Map<number, string>()
  if (uniquePicqerPackagingIds.length > 0) {
    const pkgs = await fetchInBatches<PackagingRow>(
      uniquePicqerPackagingIds,
      async batch => {
        const { data, error } = await supabase
          .schema('batchmaker')
          .from('packagings')
          .select('id, idpackaging')
          .in('idpackaging', batch as number[])
        if (error) throw error
        return (data ?? []) as PackagingRow[]
      },
    )
    for (const p of pkgs) {
      if (p.idpackaging != null) {
        packagingUuidByPicqerId.set(p.idpackaging, p.id)
      }
    }
  }
  console.log(
    `[packagings] resolved uuid-mapping for ${packagingUuidByPicqerId.size}/${uniquePicqerPackagingIds.length} picqer ids`,
  )

  // Phase 6 — group products per box, build (fingerprint, packaging_uuid) counts
  const productsByBox = new Map<string, BoxProductRow[]>()
  for (const p of products) {
    const existing = productsByBox.get(p.box_id)
    if (existing) existing.push(p)
    else productsByBox.set(p.box_id, [p])
  }

  // Aggregate map keyed by `${fingerprint}\u0000${packagingUuid}` — null byte
  // is safe as separator since fingerprints & uuids can't contain it.
  const agg = new Map<string, number>()
  let skippedEmpty = 0
  let skippedNoPackaging = 0

  for (const box of boxesWithPackaging) {
    const packagingUuid = packagingUuidByPicqerId.get(
      box.picqer_packaging_id as number,
    )
    if (!packagingUuid) {
      skippedNoPackaging++
      continue
    }

    const boxProducts = productsByBox.get(box.id) ?? []
    const core: ProductLike[] = []
    for (const p of boxProducts) {
      const attr = attrByProductId.get(p.picqer_product_id)
      if (!isAccompanying(p.productcode, attr)) {
        core.push({
          picqer_product_id: p.picqer_product_id,
          productcode: p.productcode,
          quantity: p.amount,
        })
      }
    }
    if (core.length === 0) {
      skippedEmpty++
      continue
    }
    const fingerprint = buildProductcodeFingerprint(core)
    if (!fingerprint) {
      skippedEmpty++
      continue
    }
    const key = `${fingerprint}\u0000${packagingUuid}`
    agg.set(key, (agg.get(key) ?? 0) + 1)
  }

  console.log(
    `[aggregate] unique (fingerprint, packaging): ${agg.size} | skipped_empty=${skippedEmpty} | skipped_no_packaging=${skippedNoPackaging}`,
  )

  // Phase 7 — persist
  if (!APPLY) {
    console.log('\n[dry-run] Skipping DB writes. Re-run with --apply to persist.')
    console.log(`Would upsert ${agg.size} rows.`)
    return
  }

  // Build row list
  const now = new Date().toISOString()
  const rows = Array.from(agg.entries()).map(([key, count]) => {
    const [fingerprint, packaging_id] = key.split('\u0000')
    return {
      fingerprint,
      packaging_id,
      count,
      first_seen_at: now,
      last_seen_at: now,
    }
  })

  // Upsert in chunks. ignoreDuplicates=false + onConflict forces the update
  // path. We rely on Postgres to SUM counts via the ON CONFLICT strategy,
  // which supabase-js doesn't natively express — so we do an upsert that
  // REPLACES count. For additive re-runs (without --reset) this means the
  // SECOND run will overwrite the count to the fresh aggregate, which is
  // exactly the idempotent semantics we want for a one-shot backfill.
  //
  // If you ran --apply twice WITHOUT --reset and the data changed in between,
  // the second run's counts win. That's correct: the aggregate is derived
  // from the source-of-truth packing_session_boxes and recomputed each run.
  let upserted = 0
  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await supabase
      .schema('batchmaker')
      .from('packing_observations')
      .upsert(batch, {
        onConflict: 'fingerprint,packaging_id',
        ignoreDuplicates: false,
      })
    if (error) {
      console.error('[upsert] failed:', error)
      process.exit(1)
    }
    upserted += batch.length
    process.stdout.write(`\r[upsert] ${upserted}/${rows.length}`)
  }
  console.log(`\n\nProcessed ${sessionIds.length} sessions, inserted ${agg.size} unique (fingerprint, packaging) observations`)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
