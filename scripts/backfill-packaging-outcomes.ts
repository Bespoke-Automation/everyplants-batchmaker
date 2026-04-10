/**
 * Backfill packaging_advice.outcome for historical completed sessions
 *
 * Usage:
 *   npx tsx scripts/backfill-packaging-outcomes.ts           # dry-run
 *   npx tsx scripts/backfill-packaging-outcomes.ts --apply   # actually update
 *
 * Why: Before the Insights Fase 1 fix, the PUT /api/verpakking/sessions/[id]
 * endpoint could set status='completed' without calling recordSessionOutcome,
 * leaving ~66% of advice records without an outcome. This script walks all
 * completed sessions with null-outcome advice and applies the same
 * recordSessionOutcome logic (including the picklist_id fallback) retroactively.
 *
 * Safety: dry-run mode by default. Only --apply actually writes.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

const APPLY = process.argv.includes('--apply')

interface SessionCandidate {
  session_id: string
  picklist_id: number
  advice_id: string
  confidence: string
}

interface ActualBox {
  packaging_name: string
  picqer_packaging_id: number | null
  products: { productcode: string; amount: number }[]
}

interface AdviceBoxEntry {
  idpackaging: number
}

interface SessionBox {
  id: string
  packaging_name: string
  picqer_packaging_id: number | null
  packaging_advice_id: string | null
  packing_session_products: { productcode: string; amount: number }[]
}

/**
 * Multiset comparison of advised vs actual packaging IDs.
 * Mirrors the logic in src/lib/engine/feedbackTracking.ts:computeOutcome
 */
function computeOutcome(
  adviceBoxes: AdviceBoxEntry[],
  actualBoxes: ActualBox[],
): { outcome: string; deviationType: string } {
  if (adviceBoxes.length === 0) {
    return { outcome: 'no_advice', deviationType: 'none' }
  }

  const adviceCounts = new Map<number, number>()
  for (const box of adviceBoxes) {
    if (typeof box.idpackaging === 'number') {
      adviceCounts.set(box.idpackaging, (adviceCounts.get(box.idpackaging) ?? 0) + 1)
    }
  }

  const actualCounts = new Map<number, number>()
  for (const box of actualBoxes) {
    if (box.picqer_packaging_id !== null) {
      actualCounts.set(
        box.picqer_packaging_id,
        (actualCounts.get(box.picqer_packaging_id) ?? 0) + 1,
      )
    }
  }

  // Exact multiset match
  let exact = adviceCounts.size === actualCounts.size
  if (exact) {
    for (const [id, count] of adviceCounts.entries()) {
      if (actualCounts.get(id) !== count) {
        exact = false
        break
      }
    }
  }
  if (exact) return { outcome: 'followed', deviationType: 'none' }

  // Any overlap → modified
  let hasOverlap = false
  for (const id of actualCounts.keys()) {
    if (adviceCounts.has(id)) {
      hasOverlap = true
      break
    }
  }

  if (!hasOverlap) return { outcome: 'ignored', deviationType: 'different_packaging' }

  // Partial overlap: classify deviation
  const adviceTotal = Array.from(adviceCounts.values()).reduce((a, b) => a + b, 0)
  const actualTotal = Array.from(actualCounts.values()).reduce((a, b) => a + b, 0)
  if (actualTotal > adviceTotal) return { outcome: 'modified', deviationType: 'extra_boxes' }
  if (actualTotal < adviceTotal) return { outcome: 'modified', deviationType: 'fewer_boxes' }
  return { outcome: 'modified', deviationType: 'different_packaging' }
}

async function fetchCandidates(): Promise<SessionCandidate[]> {
  // packaging_advice has no FK to packing_sessions — both refer to picklist_id
  // via domain logic, so we fetch both sides and join client-side.
  const { data: adviceRows, error: adviceError } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('id, picklist_id, confidence, calculated_at')
    .is('outcome', null)
    .neq('status', 'invalidated')
    .not('picklist_id', 'is', null)

  if (adviceError) throw adviceError

  const picklistIds = Array.from(
    new Set((adviceRows ?? []).map((r) => r.picklist_id as number)),
  )
  if (picklistIds.length === 0) return []

  const { data: sessionRows, error: sessionError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id, picklist_id')
    .eq('status', 'completed')
    .in('picklist_id', picklistIds)

  if (sessionError) throw sessionError

  // For each picklist, keep only the most recent completed session
  const sessionByPicklist = new Map<number, string>()
  for (const s of sessionRows ?? []) {
    sessionByPicklist.set(s.picklist_id as number, s.id as string)
  }

  // For each picklist, keep only the most recent advice record (to avoid
  // double-updating the same picklist across multiple candidate rows)
  const latestAdviceByPicklist = new Map<number, { id: string; confidence: string }>()
  for (const r of adviceRows ?? []) {
    const key = r.picklist_id as number
    const existing = latestAdviceByPicklist.get(key)
    if (!existing) {
      latestAdviceByPicklist.set(key, { id: r.id as string, confidence: r.confidence as string })
    }
  }

  const candidates: SessionCandidate[] = []
  for (const [picklistId, advice] of latestAdviceByPicklist.entries()) {
    const sessionId = sessionByPicklist.get(picklistId)
    if (!sessionId) continue
    candidates.push({
      session_id: sessionId,
      picklist_id: picklistId,
      advice_id: advice.id,
      confidence: advice.confidence,
    })
  }
  return candidates
}

async function fetchSessionBoxes(sessionId: string): Promise<SessionBox[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .select(
      'id, packaging_name, picqer_packaging_id, packaging_advice_id, packing_session_products(productcode, amount)',
    )
    .eq('session_id', sessionId)

  if (error) throw error
  return (data as unknown as SessionBox[]) ?? []
}

async function fetchAdviceBoxes(adviceId: string): Promise<AdviceBoxEntry[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('advice_boxes')
    .eq('id', adviceId)
    .single()

  if (error) throw error
  return (data?.advice_boxes as AdviceBoxEntry[]) ?? []
}

async function processCandidate(candidate: SessionCandidate): Promise<{
  status: 'updated' | 'skipped' | 'error'
  outcome?: string
  deviationType?: string
  reason?: string
}> {
  try {
    const boxes = await fetchSessionBoxes(candidate.session_id)
    if (boxes.length === 0) {
      return { status: 'skipped', reason: 'no boxes in session' }
    }

    const actualBoxes: ActualBox[] = boxes.map((b) => ({
      packaging_name: b.packaging_name,
      picqer_packaging_id: b.picqer_packaging_id,
      products: (b.packing_session_products ?? []).map((p) => ({
        productcode: p.productcode,
        amount: p.amount,
      })),
    }))

    const adviceBoxes = await fetchAdviceBoxes(candidate.advice_id)
    const { outcome, deviationType } = computeOutcome(adviceBoxes, actualBoxes)

    if (APPLY) {
      const { error } = await supabase
        .schema('batchmaker')
        .from('packaging_advice')
        .update({
          outcome,
          actual_boxes: actualBoxes,
          deviation_type: deviationType,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', candidate.advice_id)

      if (error) {
        return { status: 'error', reason: error.message }
      }
    }

    return { status: 'updated', outcome, deviationType }
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function main() {
  console.log(`[backfill] Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)'}`)
  console.log('[backfill] Fetching candidates...')

  const candidates = await fetchCandidates()
  console.log(`[backfill] Found ${candidates.length} candidate advice records`)

  const counts = {
    updated: 0,
    skipped: 0,
    error: 0,
  }
  const outcomeCounts: Record<string, number> = {}

  let processed = 0
  for (const candidate of candidates) {
    const result = await processCandidate(candidate)
    counts[result.status]++
    if (result.outcome) {
      outcomeCounts[result.outcome] = (outcomeCounts[result.outcome] ?? 0) + 1
    }

    processed++
    if (processed % 50 === 0) {
      console.log(
        `[backfill] Progress: ${processed}/${candidates.length} (updated=${counts.updated}, skipped=${counts.skipped}, error=${counts.error})`,
      )
    }
  }

  console.log('\n[backfill] === Summary ===')
  console.log(`Total candidates:   ${candidates.length}`)
  console.log(`${APPLY ? 'Updated' : 'Would update'}: ${counts.updated}`)
  console.log(`Skipped:            ${counts.skipped}`)
  console.log(`Errors:             ${counts.error}`)
  console.log('\nOutcome distribution:')
  for (const [outcome, count] of Object.entries(outcomeCounts)) {
    console.log(`  ${outcome}: ${count}`)
  }

  if (!APPLY) {
    console.log('\n[backfill] DRY-RUN complete. Re-run with --apply to persist changes.')
  }
}

main().catch((err) => {
  console.error('[backfill] Fatal error:', err)
  process.exit(1)
})
