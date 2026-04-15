import { supabase } from '@/lib/supabase/client'
import { getEngineSettings } from './engineSettings'

// ── Constants ────────────────────────────────────────────────────────────────

/** Rolling window for fingerprint aggregates — caps DB cost and keeps insights fresh */
export const INSIGHTS_WINDOW_DAYS = 90

// ── Types ────────────────────────────────────────────────────────────────────

export type AdviceConfidence = 'full_match' | 'partial_match' | 'no_match'
export type AdviceOutcome = 'followed' | 'modified' | 'ignored' | 'no_advice'
export type PatternStatus = 'learning' | 'active' | 'invalidated'

export interface GapMetrics {
  total: number
  coverage: { pct: number; full_match: number; partial_match: number; no_match: number }
  compliance: {
    pct: number
    resolved: number
    unresolved: number
    followed: number
    modified: number
    ignored: number
  }
  perfect: { pct: number; count: number }
}

export interface LearningFunnel {
  learning: number
  active: number
  invalidated: number
  promotedThisWeek: number
  invalidatedThisWeek: number
  newLearningThisWeek: number
}

export interface ComplianceTrendPoint {
  week: string // ISO date of week start
  total: number
  followed: number
  modified: number
  ignored: number
  followRate: number
}

export type FingerprintSuggestedAction =
  | 'healthy'
  | 'drifting'
  | 'rising'
  | 'no_consensus'
  | 'no_advice'
  | 'unresolved'

export interface FingerprintStatsRow {
  fingerprint: string
  country: string | null
  total: number
  resolved: number
  followed: number
  modified: number
  ignored: number
  followRate: number | null
  dominantBoxCombo: string | null
  dominantBoxComboShare: number | null
  distinctBoxCombos: number
  avgAdviceCost: number | null
  lastSeenAt: string | null
  suggestedAction: FingerprintSuggestedAction
}

export interface FingerprintBoxCombo {
  combo: string
  count: number
  share: number
  followed: number
  modified: number
  ignored: number
  avgAdviceCost: number | null
}

export interface FingerprintRecentRecord {
  id: string
  order_id: number
  picklist_id: number | null
  confidence: AdviceConfidence
  outcome: AdviceOutcome | null
  adviceBoxes: string[]
  actualBoxes: string[]
  calculated_at: string
}

export interface FingerprintDetail {
  fingerprint: string
  country: string | null
  stats: FingerprintStatsRow
  boxCombos: FingerprintBoxCombo[]
  recentRecords: FingerprintRecentRecord[]
}

export interface OverviewResponse {
  gap: GapMetrics
  funnel: LearningFunnel
  trend: ComplianceTrendPoint[]
}

// ── Internal helpers ─────────────────────────────────────────────────────────

type AdviceBoxItem = {
  packaging_name?: string
  idpackaging?: number
  box_cost?: number
  transport_cost?: number
  box_pack_cost?: number
  box_pick_cost?: number
  total_cost?: number
}

type ActualBoxItem = {
  packaging_name?: string
  picqer_packaging_id?: number
}

/**
 * Pick the best available country for a record. `country_code` is authoritative
 * and set on current rows; legacy rows without it sometimes embed the country
 * in the fingerprint prefix (e.g. "NL|PLANT | ..."). Returns null if neither is set.
 */
function resolveCountry(countryCode: string | null, fingerprint: string): string | null {
  if (countryCode) return countryCode
  const idx = fingerprint.indexOf('|')
  if (idx <= 0) return null
  const prefix = fingerprint.slice(0, idx)
  return /^[A-Z]{2}$/.test(prefix) ? prefix : null
}

/**
 * Grouping key that prevents cross-country merging of legacy fingerprints that
 * lack a country prefix. When the same "PLANT | P17 - P21" pattern occurs in
 * both NL and DE, we still want two separate library rows.
 */
function groupingKey(fingerprint: string, country: string | null): string {
  return country ? `${country}::${fingerprint}` : `::${fingerprint}`
}

function comboKey(boxes: Array<{ packaging_name?: string }>): string {
  const counts = new Map<string, number>()
  for (const b of boxes) {
    const name = b.packaging_name ?? '?'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${count}× ${name}`)
    .join(' + ')
}

/**
 * Sum the cost of an advice-boxes array. Prefers the stored `total_cost` per box
 * (authoritative), falls back to summing the individual components for rows
 * that pre-date that field. Returns null when cost data is not available for
 * the record — callers should check `cost_data_available` on the row.
 */
function sumAdviceCost(
  boxes: AdviceBoxItem[] | null,
  costDataAvailable: boolean | null,
): number | null {
  if (costDataAvailable === false) return null
  if (!Array.isArray(boxes) || boxes.length === 0) return null

  let total = 0
  for (const box of boxes) {
    if (typeof box.total_cost === 'number') {
      total += box.total_cost
    } else {
      total +=
        (box.box_cost ?? 0) +
        (box.transport_cost ?? 0) +
        (box.box_pack_cost ?? 0) +
        (box.box_pick_cost ?? 0)
    }
  }
  return total
}

function suggestAction(row: {
  total: number
  resolved: number
  followRate: number | null
  distinctBoxCombos: number
}): FingerprintSuggestedAction {
  if (row.total === 0) return 'no_advice'
  if (row.resolved === 0) return 'unresolved'
  if (row.followRate === null) return 'unresolved'
  if (row.distinctBoxCombos >= 3 && row.followRate < 0.5) return 'no_consensus'
  if (row.followRate < 0.6) return 'drifting'
  if (row.followRate >= 0.85 && row.total >= 10) return 'healthy'
  if (row.total >= 5 && row.followRate >= 0.7) return 'rising'
  return 'healthy'
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Gap metrics — coverage + compliance. Cost gap is deferred to Fase 2
 * because actual_boxes lacks cost data and requires a packagings join.
 */
export async function getGapMetrics(): Promise<GapMetrics> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('confidence, outcome')

  if (error) throw error

  const rows = data ?? []
  const total = rows.length

  const full_match = rows.filter((r) => r.confidence === 'full_match').length
  const partial_match = rows.filter((r) => r.confidence === 'partial_match').length
  const no_match = rows.filter((r) => r.confidence === 'no_match').length

  const resolved = rows.filter((r) => r.outcome !== null).length
  const unresolved = total - resolved
  const followed = rows.filter((r) => r.outcome === 'followed').length
  const modified = rows.filter((r) => r.outcome === 'modified').length
  const ignored = rows.filter((r) => r.outcome === 'ignored').length

  const coveragePct = total === 0 ? 0 : (full_match / total) * 100
  const compliancePct = resolved === 0 ? 0 : (followed / resolved) * 100

  const perfect = rows.filter(
    (r) => r.confidence === 'full_match' && r.outcome === 'followed',
  ).length
  const perfectPct = total === 0 ? 0 : (perfect / total) * 100

  return {
    total,
    coverage: { pct: coveragePct, full_match, partial_match, no_match },
    compliance: {
      pct: compliancePct,
      resolved,
      unresolved,
      followed,
      modified,
      ignored,
    },
    perfect: { pct: perfectPct, count: perfect },
  }
}

/**
 * Learning pipeline funnel — how healthy is pattern learning?
 */
export async function getLearningFunnel(): Promise<LearningFunnel> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('status, created_at, promoted_at, invalidated_at')

  if (error) throw error

  const rows = data ?? []
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  return {
    learning: rows.filter((r) => r.status === 'learning').length,
    active: rows.filter((r) => r.status === 'active').length,
    invalidated: rows.filter((r) => r.status === 'invalidated').length,
    promotedThisWeek: rows.filter((r) => r.promoted_at && r.promoted_at >= oneWeekAgo).length,
    invalidatedThisWeek: rows.filter(
      (r) => r.invalidated_at && r.invalidated_at >= oneWeekAgo,
    ).length,
    newLearningThisWeek: rows.filter(
      (r) => r.status === 'learning' && r.created_at >= oneWeekAgo,
    ).length,
  }
}

/**
 * Weekly compliance trend — is the follow rate improving?
 *
 * Week buckets are ISO-weeks (Monday start) in **Europe/Amsterdam** time, not
 * UTC. For a Dutch-only internal tool this matches how users think about
 * "last week": a session at Sunday 23:30 CET/CEST lives in the week that just
 * ended, not in next week's bucket. Missing weeks in the range are filled with
 * zero-total so the sparkline has an even x-axis.
 */
export async function getComplianceTrend(weeks = 12): Promise<ComplianceTrendPoint[]> {
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - weeks * 7)

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('calculated_at, outcome')
    .not('outcome', 'is', null)
    .gte('calculated_at', startDate.toISOString())

  if (error) throw error

  const buckets = new Map<string, { followed: number; modified: number; ignored: number }>()

  for (const row of data ?? []) {
    const key = amsterdamMondayKey(row.calculated_at as string)
    const bucket = buckets.get(key) ?? { followed: 0, modified: 0, ignored: 0 }
    if (row.outcome === 'followed') bucket.followed++
    else if (row.outcome === 'modified') bucket.modified++
    else if (row.outcome === 'ignored') bucket.ignored++
    buckets.set(key, bucket)
  }

  // Fill the full range with zero-weeks so the sparkline has no gaps.
  const result: ComplianceTrendPoint[] = []
  const rangeEndKey = amsterdamMondayKey(new Date().toISOString())
  let cursor = amsterdamMondayKey(startDate.toISOString())

  // Safety cap to avoid infinite loops if something goes wrong with date math
  let safety = weeks + 4
  while (safety-- > 0) {
    const b = buckets.get(cursor) ?? { followed: 0, modified: 0, ignored: 0 }
    const total = b.followed + b.modified + b.ignored
    result.push({
      week: cursor,
      total,
      followed: b.followed,
      modified: b.modified,
      ignored: b.ignored,
      followRate: total === 0 ? 0 : (b.followed / total) * 100,
    })
    if (cursor >= rangeEndKey) break
    cursor = addDaysToKey(cursor, 7)
  }

  return result
}

/**
 * Given a UTC ISO timestamp, return the ISO Monday of that week in
 * Europe/Amsterdam time, formatted as YYYY-MM-DD.
 */
function amsterdamMondayKey(isoTimestamp: string): string {
  const d = new Date(isoTimestamp)
  // Convert to Amsterdam wall time by constructing a Date from a locale string.
  // "en-CA" locale gives ISO-ish formatting "YYYY-MM-DD, HH:MM:SS".
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(d)

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'

  // Map short weekday to Monday-based offset (Mon=0, Sun=6)
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  }
  const offset = weekdayMap[weekday] ?? 0

  return addDaysToKey(`${year}-${month}-${day}`, -offset)
}

/**
 * Add (or subtract) days to a YYYY-MM-DD date-only key, returning a new key.
 * Uses UTC internally so no DST weirdness — we only manipulate the calendar
 * date, not a specific wall-clock time.
 */
function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  const yy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/**
 * Fingerprint statistics — the "library" view for management.
 *
 * Aggregates packaging_advice rows by (shipping_unit_fingerprint, country_code)
 * within a rolling window (INSIGHTS_WINDOW_DAYS). The window caps the DB cost
 * and keeps the library focused on current behavior rather than ancient history.
 */
export async function getFingerprintStats(limit = 200): Promise<FingerprintStatsRow[]> {
  const windowStart = new Date(
    Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select(
      'shipping_unit_fingerprint, country_code, outcome, advice_boxes, actual_boxes, cost_data_available, calculated_at',
    )
    .not('shipping_unit_fingerprint', 'is', null)
    .gte('calculated_at', windowStart)

  if (error) throw error

  type GroupEntry = {
    fingerprint: string
    country: string | null
    records: Array<{
      outcome: AdviceOutcome | null
      adviceCost: number | null
      adviceCombo: string
      actualCombo: string | null
      calculated_at: string
    }>
    lastSeenAt: string
  }

  const groups = new Map<string, GroupEntry>()

  for (const row of data ?? []) {
    const fp = row.shipping_unit_fingerprint as string
    const country = resolveCountry(row.country_code as string | null, fp)
    const key = groupingKey(fp, country)

    const adviceCost = sumAdviceCost(
      row.advice_boxes as AdviceBoxItem[] | null,
      row.cost_data_available as boolean | null,
    )
    const adviceCombo = comboKey((row.advice_boxes as AdviceBoxItem[] | null) ?? [])
    const actualBoxes = row.actual_boxes as ActualBoxItem[] | null
    const actualCombo = actualBoxes && actualBoxes.length > 0 ? comboKey(actualBoxes) : null
    const calculatedAt = row.calculated_at as string

    const existing = groups.get(key)
    if (existing) {
      existing.records.push({
        outcome: row.outcome as AdviceOutcome | null,
        adviceCost,
        adviceCombo,
        actualCombo,
        calculated_at: calculatedAt,
      })
      if (calculatedAt > existing.lastSeenAt) existing.lastSeenAt = calculatedAt
    } else {
      groups.set(key, {
        fingerprint: fp,
        country,
        records: [
          {
            outcome: row.outcome as AdviceOutcome | null,
            adviceCost,
            adviceCombo,
            actualCombo,
            calculated_at: calculatedAt,
          },
        ],
        lastSeenAt: calculatedAt,
      })
    }
  }

  const rows: FingerprintStatsRow[] = []

  for (const group of groups.values()) {
    const total = group.records.length
    const resolved = group.records.filter((r) => r.outcome !== null).length
    const followed = group.records.filter((r) => r.outcome === 'followed').length
    const modified = group.records.filter((r) => r.outcome === 'modified').length
    const ignored = group.records.filter((r) => r.outcome === 'ignored').length
    const followRate = resolved === 0 ? null : followed / resolved

    // Dominant box combo = most-chosen actual_boxes combination across records
    // that have actual data; falls back to advice combo if none.
    const comboCounts = new Map<string, number>()
    for (const r of group.records) {
      const combo = r.actualCombo ?? r.adviceCombo
      if (!combo) continue
      comboCounts.set(combo, (comboCounts.get(combo) ?? 0) + 1)
    }
    let dominantBoxCombo: string | null = null
    let dominantCount = 0
    for (const [combo, count] of comboCounts.entries()) {
      if (count > dominantCount) {
        dominantCount = count
        dominantBoxCombo = combo
      }
    }
    const dominantBoxComboShare =
      dominantBoxCombo === null || total === 0 ? null : dominantCount / total

    const distinctBoxCombos = comboCounts.size

    const costs = group.records.map((r) => r.adviceCost).filter((c): c is number => c !== null)
    const avgAdviceCost =
      costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0) / costs.length

    const suggestedAction = suggestAction({ total, resolved, followRate, distinctBoxCombos })

    rows.push({
      fingerprint: group.fingerprint,
      country: group.country,
      total,
      resolved,
      followed,
      modified,
      ignored,
      followRate: followRate === null ? null : followRate * 100,
      dominantBoxCombo,
      dominantBoxComboShare:
        dominantBoxComboShare === null ? null : dominantBoxComboShare * 100,
      distinctBoxCombos,
      avgAdviceCost,
      lastSeenAt: group.lastSeenAt,
      suggestedAction,
    })
  }

  return rows.sort((a, b) => b.total - a.total).slice(0, limit)
}

/**
 * Drill-down for a single fingerprint — shows all box-combinations used,
 * their share, and the last 20 records for traceability.
 *
 * Two queries instead of one:
 *   1. Aggregate over the rolling INSIGHTS_WINDOW_DAYS window for the stats.
 *   2. Last 20 records, unbounded by date, for the recent-records table.
 * This keeps the stats query cheap while still showing workers the most
 * recent activity even when the window is quiet.
 *
 * @param country optional country filter. When omitted, matches the record set
 *                that `getFingerprintStats` uses as the "no-country" bucket.
 */
export async function getFingerprintDetail(
  fingerprint: string,
  country: string | null = null,
): Promise<FingerprintDetail | null> {
  const windowStart = new Date(
    Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  // Query 1: aggregate over the rolling window
  let aggregateQuery = supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select(
      'outcome, advice_boxes, actual_boxes, cost_data_available, calculated_at, country_code',
    )
    .eq('shipping_unit_fingerprint', fingerprint)
    .gte('calculated_at', windowStart)

  if (country) {
    aggregateQuery = aggregateQuery.eq('country_code', country)
  } else {
    aggregateQuery = aggregateQuery.is('country_code', null)
  }

  const { data: aggRows, error: aggError } = await aggregateQuery
  if (aggError) throw aggError

  // Query 2: last 20 records (any date) for the traceability table
  let recentQuery = supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select(
      'id, order_id, picklist_id, confidence, outcome, advice_boxes, actual_boxes, calculated_at, country_code',
    )
    .eq('shipping_unit_fingerprint', fingerprint)
    .order('calculated_at', { ascending: false })
    .limit(20)

  if (country) {
    recentQuery = recentQuery.eq('country_code', country)
  } else {
    recentQuery = recentQuery.is('country_code', null)
  }

  const { data: recentRows, error: recentError } = await recentQuery
  if (recentError) throw recentError

  const aggregateRecords = aggRows ?? []
  const recent = recentRows ?? []

  // If neither query returned anything, the fingerprint doesn't exist at all
  if (aggregateRecords.length === 0 && recent.length === 0) return null

  // Aggregate stats from query 1
  const comboBuckets = new Map<
    string,
    {
      count: number
      followed: number
      modified: number
      ignored: number
      costs: number[]
    }
  >()

  const total = aggregateRecords.length
  let resolved = 0
  let followed = 0
  let modified = 0
  let ignored = 0

  for (const r of aggregateRecords) {
    if (r.outcome !== null) resolved++
    if (r.outcome === 'followed') followed++
    if (r.outcome === 'modified') modified++
    if (r.outcome === 'ignored') ignored++

    const actualBoxes = r.actual_boxes as ActualBoxItem[] | null
    const adviceBoxes = r.advice_boxes as AdviceBoxItem[] | null
    const combo =
      actualBoxes && actualBoxes.length > 0 ? comboKey(actualBoxes) : comboKey(adviceBoxes ?? [])
    if (!combo) continue

    const bucket = comboBuckets.get(combo) ?? {
      count: 0,
      followed: 0,
      modified: 0,
      ignored: 0,
      costs: [],
    }
    bucket.count++
    if (r.outcome === 'followed') bucket.followed++
    if (r.outcome === 'modified') bucket.modified++
    if (r.outcome === 'ignored') bucket.ignored++
    const cost = sumAdviceCost(adviceBoxes, r.cost_data_available as boolean | null)
    if (cost !== null) bucket.costs.push(cost)
    comboBuckets.set(combo, bucket)
  }

  const followRate = resolved === 0 ? null : (followed / resolved) * 100
  const distinctBoxCombos = comboBuckets.size

  let dominantCombo: string | null = null
  let dominantCount = 0
  for (const [combo, bucket] of comboBuckets.entries()) {
    if (bucket.count > dominantCount) {
      dominantCount = bucket.count
      dominantCombo = combo
    }
  }

  const boxCombos: FingerprintBoxCombo[] = Array.from(comboBuckets.entries())
    .map(([combo, bucket]) => ({
      combo,
      count: bucket.count,
      share: total === 0 ? 0 : (bucket.count / total) * 100,
      followed: bucket.followed,
      modified: bucket.modified,
      ignored: bucket.ignored,
      avgAdviceCost:
        bucket.costs.length === 0
          ? null
          : bucket.costs.reduce((a, b) => a + b, 0) / bucket.costs.length,
    }))
    .sort((a, b) => b.count - a.count)

  const recentRecords: FingerprintRecentRecord[] = recent.map((r) => {
    const adviceBoxes = (r.advice_boxes as AdviceBoxItem[] | null) ?? []
    const actualBoxes = (r.actual_boxes as ActualBoxItem[] | null) ?? []
    return {
      id: r.id as string,
      order_id: r.order_id as number,
      picklist_id: r.picklist_id as number | null,
      confidence: r.confidence as AdviceConfidence,
      outcome: r.outcome as AdviceOutcome | null,
      adviceBoxes: adviceBoxes.map((b) => b.packaging_name ?? '?'),
      actualBoxes: actualBoxes.map((b) => b.packaging_name ?? '?'),
      calculated_at: r.calculated_at as string,
    }
  })

  const allCosts: number[] = []
  for (const bucket of comboBuckets.values()) {
    allCosts.push(...bucket.costs)
  }
  const avgAdviceCost =
    allCosts.length === 0 ? null : allCosts.reduce((a, b) => a + b, 0) / allCosts.length

  const suggestedAction = suggestAction({ total, resolved, followRate, distinctBoxCombos })

  const resolvedCountry =
    country ??
    resolveCountry(
      (recent[0]?.country_code as string | null) ??
        (aggregateRecords[0]?.country_code as string | null) ??
        null,
      fingerprint,
    )

  // lastSeenAt: prefer the most recent record we actually have (recent list)
  const lastSeenAt =
    (recent[0]?.calculated_at as string | undefined) ??
    aggregateRecords
      .map((r) => r.calculated_at as string)
      .reduce<string | null>((max, t) => (max === null || t > max ? t : max), null)

  return {
    fingerprint,
    country: resolvedCountry,
    stats: {
      fingerprint,
      country: resolvedCountry,
      total,
      resolved,
      followed,
      modified,
      ignored,
      followRate,
      dominantBoxCombo: dominantCombo,
      dominantBoxComboShare:
        dominantCombo === null || total === 0 ? null : (dominantCount / total) * 100,
      distinctBoxCombos,
      avgAdviceCost,
      lastSeenAt: lastSeenAt ?? null,
      suggestedAction,
    },
    boxCombos,
    recentRecords,
  }
}

// ── Worker Compliance (Fase 3) ───────────────────────────────────────────────

export interface WorkerComplianceRow {
  workerId: number
  workerName: string
  totalSessions: number
  sessionsWithOutcome: number
  followed: number
  modified: number
  ignored: number
  followRate: number | null // null if no sessions with outcome
  vsAverage: number // delta in percentage points vs overall average
  needsAttention: boolean // follow rate > 10pp below average
}

export interface WorkerDetailData {
  worker: WorkerComplianceRow
  recentSessions: Array<{
    sessionId: string
    picklistId: number
    completedAt: string | null
    outcome: AdviceOutcome | null
    confidence: AdviceConfidence | null
    adviceBoxes: string[]
    actualBoxes: string[]
  }>
  weeklyTrend: Array<{
    week: string
    total: number
    followed: number
    followRate: number
  }>
}

/**
 * Worker compliance overview — aggregates packaging_advice.outcome at the
 * session level per worker. Uses the most recent non-invalidated advice per
 * picklist to avoid double-counting when the engine re-runs.
 */
export async function getWorkerComplianceStats(): Promise<WorkerComplianceRow[]> {
  // Fetch completed sessions
  const { data: sessions, error: sessionsError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id, picklist_id, assigned_to, assigned_to_name')
    .eq('status', 'completed')

  if (sessionsError) throw sessionsError

  // Fetch all resolved advice with outcome
  const picklistIds = Array.from(
    new Set((sessions ?? []).map((s) => s.picklist_id as number)),
  )

  if (picklistIds.length === 0) return []

  // Chunk picklist IDs to stay within PostgREST URL limits
  const CHUNK_SIZE = 150
  const adviceByPicklist = new Map<
    number,
    { outcome: AdviceOutcome; calculated_at: string }
  >()

  for (let i = 0; i < picklistIds.length; i += CHUNK_SIZE) {
    const chunk = picklistIds.slice(i, i + CHUNK_SIZE)
    const { data: adviceRows, error: adviceError } = await supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .select('picklist_id, outcome, calculated_at')
      .in('picklist_id', chunk)
      .not('outcome', 'is', null)
      .neq('status', 'invalidated')
      .order('calculated_at', { ascending: false })

    if (adviceError) throw adviceError

    // Keep only the most recent advice per picklist (avoid double-counting)
    for (const row of adviceRows ?? []) {
      const plId = row.picklist_id as number
      if (!adviceByPicklist.has(plId)) {
        adviceByPicklist.set(plId, {
          outcome: row.outcome as AdviceOutcome,
          calculated_at: row.calculated_at as string,
        })
      }
    }
  }

  // Aggregate per worker
  const workers = new Map<
    number,
    {
      name: string
      total: number
      withOutcome: number
      followed: number
      modified: number
      ignored: number
    }
  >()

  for (const s of sessions ?? []) {
    const workerId = s.assigned_to as number
    const name = s.assigned_to_name as string
    const w = workers.get(workerId) ?? {
      name,
      total: 0,
      withOutcome: 0,
      followed: 0,
      modified: 0,
      ignored: 0,
    }
    w.total++

    const advice = adviceByPicklist.get(s.picklist_id as number)
    if (advice) {
      w.withOutcome++
      if (advice.outcome === 'followed') w.followed++
      else if (advice.outcome === 'modified') w.modified++
      else if (advice.outcome === 'ignored') w.ignored++
    }

    workers.set(workerId, w)
  }

  // Compute overall average follow rate
  let totalFollowed = 0
  let totalWithOutcome = 0
  for (const w of workers.values()) {
    totalFollowed += w.followed
    totalWithOutcome += w.withOutcome
  }
  const avgFollowRate = totalWithOutcome === 0 ? 0 : (totalFollowed / totalWithOutcome) * 100

  const rows: WorkerComplianceRow[] = []
  for (const [workerId, w] of workers.entries()) {
    const followRate = w.withOutcome === 0 ? null : (w.followed / w.withOutcome) * 100
    const vsAverage = followRate === null ? 0 : followRate - avgFollowRate
    rows.push({
      workerId,
      workerName: w.name,
      totalSessions: w.total,
      sessionsWithOutcome: w.withOutcome,
      followed: w.followed,
      modified: w.modified,
      ignored: w.ignored,
      followRate,
      vsAverage,
      needsAttention: followRate !== null && followRate < avgFollowRate - 10,
    })
  }

  return rows.sort((a, b) => b.totalSessions - a.totalSessions)
}

/**
 * Detailed view for a single worker: compliance stats + recent sessions with
 * outcome + weekly trend over the last 12 weeks.
 */
export async function getWorkerDetail(workerId: number): Promise<WorkerDetailData | null> {
  // Fetch recent completed sessions for this worker
  const { data: sessions, error: sessionsError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id, picklist_id, assigned_to_name, completed_at')
    .eq('assigned_to', workerId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(100) // last 100 sessions for trend + recent list

  if (sessionsError) throw sessionsError
  if (!sessions || sessions.length === 0) return null

  const workerName = sessions[0].assigned_to_name as string
  const picklistIds = sessions.map((s) => s.picklist_id as number)

  // Fetch advice for these picklists
  const CHUNK_SIZE = 150
  const adviceByPicklist = new Map<
    number,
    {
      outcome: AdviceOutcome
      confidence: AdviceConfidence
      adviceBoxes: string[]
      actualBoxes: string[]
      calculated_at: string
    }
  >()

  for (let i = 0; i < picklistIds.length; i += CHUNK_SIZE) {
    const chunk = picklistIds.slice(i, i + CHUNK_SIZE)
    const { data: adviceRows, error: adviceError } = await supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .select(
        'picklist_id, outcome, confidence, advice_boxes, actual_boxes, calculated_at',
      )
      .in('picklist_id', chunk)
      .not('outcome', 'is', null)
      .neq('status', 'invalidated')
      .order('calculated_at', { ascending: false })

    if (adviceError) throw adviceError

    for (const row of adviceRows ?? []) {
      const plId = row.picklist_id as number
      if (!adviceByPicklist.has(plId)) {
        const advBoxes = (row.advice_boxes as Array<{ packaging_name?: string }>) ?? []
        const actBoxes = (row.actual_boxes as Array<{ packaging_name?: string }>) ?? []
        adviceByPicklist.set(plId, {
          outcome: row.outcome as AdviceOutcome,
          confidence: row.confidence as AdviceConfidence,
          adviceBoxes: advBoxes.map((b) => b.packaging_name ?? '?'),
          actualBoxes: actBoxes.map((b) => b.packaging_name ?? '?'),
          calculated_at: row.calculated_at as string,
        })
      }
    }
  }

  // Build recent sessions list (last 20)
  const recentSessions = sessions.slice(0, 20).map((s) => {
    const advice = adviceByPicklist.get(s.picklist_id as number)
    return {
      sessionId: s.id as string,
      picklistId: s.picklist_id as number,
      completedAt: s.completed_at as string | null,
      outcome: advice?.outcome ?? null,
      confidence: advice?.confidence ?? null,
      adviceBoxes: advice?.adviceBoxes ?? [],
      actualBoxes: advice?.actualBoxes ?? [],
    }
  })

  // Aggregate stats
  let followed = 0
  let modified = 0
  let ignored = 0
  let withOutcome = 0

  for (const s of sessions) {
    const advice = adviceByPicklist.get(s.picklist_id as number)
    if (advice) {
      withOutcome++
      if (advice.outcome === 'followed') followed++
      else if (advice.outcome === 'modified') modified++
      else if (advice.outcome === 'ignored') ignored++
    }
  }

  const followRate = withOutcome === 0 ? null : (followed / withOutcome) * 100

  // Weekly trend (last 12 weeks, Amsterdam time)
  const weekBuckets = new Map<string, { total: number; followed: number }>()
  for (const s of sessions) {
    const completedAt = s.completed_at as string | null
    if (!completedAt) continue

    const weekKey = amsterdamMondayKey(completedAt)
    const bucket = weekBuckets.get(weekKey) ?? { total: 0, followed: 0 }
    bucket.total++
    const advice = adviceByPicklist.get(s.picklist_id as number)
    if (advice?.outcome === 'followed') bucket.followed++
    weekBuckets.set(weekKey, bucket)
  }

  const weeklyTrend = Array.from(weekBuckets.entries())
    .map(([week, b]) => ({
      week,
      total: b.total,
      followed: b.followed,
      followRate: b.total === 0 ? 0 : (b.followed / b.total) * 100,
    }))
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-12)

  // Get overall average for vsAverage calculation
  const allStats = await getWorkerComplianceStats()
  const avgFollowRate =
    allStats.reduce((sum, w) => sum + (w.followRate ?? 0), 0) /
    Math.max(1, allStats.filter((w) => w.followRate !== null).length)

  return {
    worker: {
      workerId,
      workerName,
      totalSessions: sessions.length,
      sessionsWithOutcome: withOutcome,
      followed,
      modified,
      ignored,
      followRate,
      vsAverage: followRate === null ? 0 : followRate - avgFollowRate,
      needsAttention: followRate !== null && followRate < avgFollowRate - 10,
    },
    recentSessions,
    weeklyTrend,
  }
}

// ── Learned Packing Patterns ─────────────────────────────────────────────────

export type LearnedPatternStatus = 'learning' | 'active' | 'invalidated'

export interface LearnedPatternBoxUnit {
  name: string
  qty: number
}

export interface LearnedPatternBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  units: LearnedPatternBoxUnit[]
}

export interface LearnedPatternProductEntry {
  productcode: string
  productName: string | null
  quantity: number
}

export interface LearnedPatternRow {
  id: string
  fingerprint: string
  products: LearnedPatternProductEntry[]
  boxPattern: LearnedPatternBox[]
  status: LearnedPatternStatus
  timesSeen: number
  timesOverridden: number
  overrideRatio: number
  promotionProgress: number // 0-1, how close to promotion_threshold
  promotionThreshold: number // the threshold value from engine_settings
  lastSeenAt: string
  promotedAt: string | null
  invalidatedAt: string | null
  invalidationReason: string | null
  isDrifting: boolean // active + override ratio climbing toward invalidation threshold
}

export interface LearnedPatternDetail extends LearnedPatternRow {
  recentSessions: Array<{
    session_id: string
    picklist_id: number | null
    completed_at: string | null
    assigned_to_name: string | null
  }>
}

export interface LearnedPatternsFilters {
  status?: LearnedPatternStatus | 'all'
  minTimesSeen?: number
  search?: string // matches productcode or product name substring
}

/**
 * Parse a product-level fingerprint like "333016255:2|278823421:1" into
 * individual entries. Handles whitespace and returns an empty array on
 * malformed input (which shouldn't happen for engine-written data).
 */
function parseProductFingerprint(fingerprint: string): Array<{ productcode: string; quantity: number }> {
  if (!fingerprint) return []
  return fingerprint
    .split('|')
    .map((part) => {
      const [code, qtyStr] = part.split(':')
      const quantity = Number(qtyStr)
      if (!code || Number.isNaN(quantity)) return null
      return { productcode: code.trim(), quantity }
    })
    .filter((x): x is { productcode: string; quantity: number } => x !== null)
}

/**
 * Resolve a set of productcodes to their product names via the
 * batchmaker.product_attributes cache. Returns a Map for O(1) lookup.
 * Missing codes are silently omitted — the caller should fall back to
 * the productcode for display.
 *
 * Chunks the `.in()` query into batches of 150 to stay well within
 * PostgREST's URL length limit (~15 KB on Supabase).
 */
async function resolveProductNames(productcodes: string[]): Promise<Map<string, string>> {
  if (productcodes.length === 0) return new Map()
  const unique = Array.from(new Set(productcodes))
  const CHUNK_SIZE = 150

  const map = new Map<string, string>()

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('productcode, product_name')
      .in('productcode', chunk)

    if (error) {
      console.warn('[insights] resolveProductNames chunk error:', error)
      continue
    }

    for (const row of data ?? []) {
      if (row.productcode && row.product_name) {
        map.set(row.productcode as string, row.product_name as string)
      }
    }
  }

  return map
}

function buildLearnedPatternRow(
  raw: {
    id: string
    fingerprint: string
    box_pattern: unknown
    times_seen: number
    times_overridden: number
    status: LearnedPatternStatus
    last_seen_at: string
    promoted_at: string | null
    invalidated_at: string | null
    invalidation_reason: string | null
  },
  productNames: Map<string, string>,
  settings: { invalidation_override_ratio: number; promotion_threshold: number },
): LearnedPatternRow {
  const parsed = parseProductFingerprint(raw.fingerprint)
  const products: LearnedPatternProductEntry[] = parsed.map((p) => ({
    productcode: p.productcode,
    productName: productNames.get(p.productcode) ?? null,
    quantity: p.quantity,
  }))

  const boxPattern = Array.isArray(raw.box_pattern)
    ? (raw.box_pattern as LearnedPatternBox[])
    : []

  const totalObs = raw.times_seen + raw.times_overridden
  const overrideRatio = totalObs === 0 ? 0 : raw.times_overridden / totalObs
  const promotionProgress =
    raw.status === 'learning'
      ? Math.min(1, raw.times_seen / settings.promotion_threshold)
      : 1

  // Pattern is "drifting" when it's active and the override ratio is climbing
  // toward the invalidation threshold (within 20 percentage points).
  const isDrifting =
    raw.status === 'active' &&
    overrideRatio >= Math.max(0, settings.invalidation_override_ratio - 0.2)

  return {
    id: raw.id,
    fingerprint: raw.fingerprint,
    products,
    boxPattern,
    status: raw.status,
    timesSeen: raw.times_seen,
    timesOverridden: raw.times_overridden,
    overrideRatio,
    promotionProgress,
    promotionThreshold: settings.promotion_threshold,
    lastSeenAt: raw.last_seen_at,
    promotedAt: raw.promoted_at,
    invalidatedAt: raw.invalidated_at,
    invalidationReason: raw.invalidation_reason,
    isDrifting,
  }
}

/**
 * List learned packing patterns with product names resolved and promotion
 * progress calculated. Sorted by status priority (active → learning →
 * invalidated), then by times_seen desc.
 */
export async function getLearnedPatterns(
  filters: LearnedPatternsFilters = {},
): Promise<LearnedPatternRow[]> {
  const settings = await getEngineSettings()

  let query = supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select(
      'id, fingerprint, box_pattern, times_seen, times_overridden, status, last_seen_at, promoted_at, invalidated_at, invalidation_reason',
    )

  if (filters.status && filters.status !== 'all') {
    query = query.eq('status', filters.status)
  }
  if (filters.minTimesSeen && filters.minTimesSeen > 0) {
    query = query.gte('times_seen', filters.minTimesSeen)
  }

  const { data, error } = await query.order('last_seen_at', { ascending: false })
  if (error) throw error

  const rawRows = data ?? []

  // Collect all productcodes for name resolution
  const allCodes = new Set<string>()
  for (const row of rawRows) {
    for (const p of parseProductFingerprint(row.fingerprint as string)) {
      allCodes.add(p.productcode)
    }
  }
  const productNames = await resolveProductNames(Array.from(allCodes))

  let rows = rawRows.map((r) =>
    buildLearnedPatternRow(
      {
        id: r.id as string,
        fingerprint: r.fingerprint as string,
        box_pattern: r.box_pattern,
        times_seen: r.times_seen as number,
        times_overridden: r.times_overridden as number,
        status: r.status as LearnedPatternStatus,
        last_seen_at: r.last_seen_at as string,
        promoted_at: r.promoted_at as string | null,
        invalidated_at: r.invalidated_at as string | null,
        invalidation_reason: r.invalidation_reason as string | null,
      },
      productNames,
      settings,
    ),
  )

  // Client-side search filter (substring match on productcode or resolved name)
  if (filters.search && filters.search.trim()) {
    const q = filters.search.toLowerCase().trim()
    rows = rows.filter(
      (r) =>
        r.fingerprint.toLowerCase().includes(q) ||
        r.products.some(
          (p) =>
            p.productcode.toLowerCase().includes(q) ||
            (p.productName?.toLowerCase().includes(q) ?? false),
        ) ||
        r.boxPattern.some((b) => b.packaging_name.toLowerCase().includes(q)),
    )
  }

  // Sort: active (priority 0) → learning (1) → invalidated (2); then times_seen desc
  const statusOrder: Record<LearnedPatternStatus, number> = {
    active: 0,
    learning: 1,
    invalidated: 2,
  }
  rows.sort((a, b) => {
    const diff = statusOrder[a.status] - statusOrder[b.status]
    if (diff !== 0) return diff
    return b.timesSeen - a.timesSeen
  })

  return rows
}

/**
 * Get a single learned pattern with its recent sessions (the sessions that
 * trained it or use it today). Limited to 20 sessions for the drill-down.
 */
export async function getLearnedPatternDetail(
  id: string,
): Promise<LearnedPatternDetail | null> {
  const settings = await getEngineSettings()

  const { data: raw, error } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select(
      'id, fingerprint, box_pattern, times_seen, times_overridden, status, last_seen_at, promoted_at, invalidated_at, invalidation_reason',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!raw) return null

  const codes = parseProductFingerprint(raw.fingerprint as string).map((p) => p.productcode)
  const productNames = await resolveProductNames(codes)

  const row = buildLearnedPatternRow(
    {
      id: raw.id as string,
      fingerprint: raw.fingerprint as string,
      box_pattern: raw.box_pattern,
      times_seen: raw.times_seen as number,
      times_overridden: raw.times_overridden as number,
      status: raw.status as LearnedPatternStatus,
      last_seen_at: raw.last_seen_at as string,
      promoted_at: raw.promoted_at as string | null,
      invalidated_at: raw.invalidated_at as string | null,
      invalidation_reason: raw.invalidation_reason as string | null,
    },
    productNames,
    settings,
  )

  // Fetch recent sessions that match this fingerprint via packaging_advice
  // (we don't have a direct FK from learned_packing_patterns to sessions)
  const { data: adviceRows } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('id, picklist_id, calculated_at, learned_pattern_id')
    .eq('learned_pattern_id', id)
    .order('calculated_at', { ascending: false })
    .limit(20)

  const picklistIds = Array.from(
    new Set((adviceRows ?? []).map((r) => r.picklist_id as number).filter((p) => p !== null)),
  )

  let sessionsByPicklist = new Map<
    number,
    { session_id: string; completed_at: string | null; assigned_to_name: string | null }
  >()

  if (picklistIds.length > 0) {
    const { data: sessions } = await supabase
      .schema('batchmaker')
      .from('packing_sessions')
      .select('id, picklist_id, completed_at, assigned_to_name')
      .in('picklist_id', picklistIds)

    sessionsByPicklist = new Map(
      (sessions ?? []).map((s) => [
        s.picklist_id as number,
        {
          session_id: s.id as string,
          completed_at: s.completed_at as string | null,
          assigned_to_name: s.assigned_to_name as string | null,
        },
      ]),
    )
  }

  const recentSessions = (adviceRows ?? [])
    .map((r) => {
      const picklistId = r.picklist_id as number | null
      if (picklistId === null) return null
      const session = sessionsByPicklist.get(picklistId)
      return {
        session_id: session?.session_id ?? '',
        picklist_id: picklistId,
        completed_at: session?.completed_at ?? null,
        assigned_to_name: session?.assigned_to_name ?? null,
      }
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)

  return { ...row, recentSessions }
}

/**
 * Flip a learned pattern to invalidated status. The reason is optional but
 * recommended for the audit trail.
 */
export async function invalidateLearnedPattern(id: string, reason?: string): Promise<void> {
  const { error, count } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .update({
      status: 'invalidated',
      invalidated_at: new Date().toISOString(),
      invalidation_reason: reason ?? 'Manually invalidated via Insights UI',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .neq('status', 'invalidated') // don't overwrite existing invalidation reason/timestamp

  if (error) throw error
  if (count === 0) {
    console.warn(`[insights] invalidateLearnedPattern: pattern ${id} was already invalidated or not found`)
  }
}

/**
 * Reactivate an invalidated pattern. Reads times_seen to decide the target
 * status (learning vs active), then writes with a status guard
 * `.eq('status', 'invalidated')` so a concurrent change can't be stomped.
 */
export async function reactivateLearnedPattern(id: string): Promise<void> {
  const settings = await getEngineSettings()
  const now = new Date().toISOString()

  const { data: current, error: readError } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('times_seen')
    .eq('id', id)
    .eq('status', 'invalidated')
    .maybeSingle()

  if (readError) throw readError
  if (!current) return // already reactivated or not found

  const nextStatus: LearnedPatternStatus =
    (current.times_seen as number) >= settings.promotion_threshold ? 'active' : 'learning'

  const { error: updateError } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .update({
      status: nextStatus,
      invalidated_at: null,
      invalidation_reason: null,
      promoted_at: nextStatus === 'active' ? now : null,
      updated_at: now,
    })
    .eq('id', id)
    .eq('status', 'invalidated') // guard: only update if still invalidated

  if (updateError) throw updateError
}

// ── V2: Observation-based insights (new engine model) ────────────────────────
//
// Reads from `batchmaker.packing_observations` (productcode-fingerprint,
// land-onafhankelijk). The V2 code path lives side-by-side with V1 so the
// library UI can offer a `?model=observation|legacy` toggle while ops
// compares behaviour during the engine-simplification migration.
//
// The `packing_observations` table is created by a parallel workstream.
// Until it exists, V2 queries return empty results gracefully — we detect
// the PostgREST "relation does not exist" error (42P01) and treat the row
// set as empty instead of bubbling up a 500.

export type FingerprintDetailResult = FingerprintDetail

interface PackingObservationRow {
  fingerprint: string
  packaging_id: string
  count: number
  last_seen_at: string
}

/**
 * True when the error indicates the `packing_observations` table does not
 * yet exist (migration hasn't run). Returns empty data upstream so V2 can
 * ship before the table is live.
 */
function isMissingObservationsTable(error: { code?: string; message?: string }): boolean {
  if (!error) return false
  if (error.code === '42P01') return true
  if (error.code === 'PGRST116') return true
  const msg = error.message ?? ''
  return (
    /relation\s+"?batchmaker\.packing_observations"?\s+does\s+not\s+exist/i.test(msg) ||
    /could not find the table 'batchmaker\.packing_observations'/i.test(msg)
  )
}

async function fetchPackingObservations(): Promise<PackingObservationRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_observations')
    .select('fingerprint, packaging_id, count, last_seen_at')

  if (error) {
    if (isMissingObservationsTable(error)) {
      console.info(
        '[insights V2] packing_observations not yet available — returning empty result',
      )
      return []
    }
    throw error
  }

  return (data ?? []).map((r) => ({
    fingerprint: r.fingerprint as string,
    packaging_id: r.packaging_id as string,
    count: Number(r.count ?? 0),
    last_seen_at: r.last_seen_at as string,
  }))
}

async function fetchObservationsForFingerprint(
  fingerprint: string,
): Promise<PackingObservationRow[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_observations')
    .select('fingerprint, packaging_id, count, last_seen_at')
    .eq('fingerprint', fingerprint)

  if (error) {
    if (isMissingObservationsTable(error)) return []
    throw error
  }

  return (data ?? []).map((r) => ({
    fingerprint: r.fingerprint as string,
    packaging_id: r.packaging_id as string,
    count: Number(r.count ?? 0),
    last_seen_at: r.last_seen_at as string,
  }))
}

/**
 * Resolve packaging_id → packaging name via the local packagings table.
 * Chunks to stay within PostgREST URL limits.
 */
async function fetchPackagingNames(
  packagingIds: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(packagingIds))
  if (unique.length === 0) return new Map()

  const CHUNK_SIZE = 150
  const map = new Map<string, string>()

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('id, name')
      .in('id', chunk)

    if (error) {
      console.warn('[insights V2] fetchPackagingNames chunk error:', error)
      continue
    }

    for (const row of data ?? []) {
      if (row.id && row.name) {
        map.set(row.id as string, row.name as string)
      }
    }
  }

  return map
}

/**
 * V2 suggested-action logic — observation model.
 *
 *  - `healthy`       share ≥ 85% AND total ≥ 5
 *  - `rising`        total < 3 (too few samples for consensus)
 *  - `no_consensus`  share < 50%
 *  - `drifting`      share 50-85% AND distinctBoxCombos ≥ 3
 *  - otherwise       `healthy`
 */
function suggestActionV2(args: {
  total: number
  share: number
  distinctBoxCombos: number
}): FingerprintSuggestedAction {
  const { total, share, distinctBoxCombos } = args
  if (total < 3) return 'rising'
  if (share < 0.5) return 'no_consensus'
  if (share >= 0.85 && total >= 5) return 'healthy'
  if (share < 0.85 && distinctBoxCombos >= 3) return 'drifting'
  return 'healthy'
}

/**
 * V2 fingerprint library — groups packing_observations by fingerprint,
 * resolves packaging names, computes share/dominant combo/distinct combos.
 *
 * Shape matches V1 `FingerprintStatsRow` for UI compatibility. `country` is
 * always null (observation model is land-onafhankelijk). `resolved/followed/
 * modified/ignored` are 0 (not meaningful without advice outcomes). The
 * followRate mirrors dominantBoxComboShare since consensus IS the signal.
 */
export async function getFingerprintStatsV2(limit = 200): Promise<FingerprintStatsRow[]> {
  const observations = await fetchPackingObservations()
  if (observations.length === 0) return []

  // Group by fingerprint → per-packaging counts
  type Group = {
    fingerprint: string
    total: number
    entries: Map<string, { count: number; lastSeenAt: string }>
    lastSeenAt: string
  }

  const groups = new Map<string, Group>()

  for (const obs of observations) {
    const g = groups.get(obs.fingerprint) ?? {
      fingerprint: obs.fingerprint,
      total: 0,
      entries: new Map(),
      lastSeenAt: obs.last_seen_at,
    }

    g.total += obs.count
    if (obs.last_seen_at > g.lastSeenAt) g.lastSeenAt = obs.last_seen_at

    const existing = g.entries.get(obs.packaging_id)
    if (existing) {
      existing.count += obs.count
      if (obs.last_seen_at > existing.lastSeenAt) existing.lastSeenAt = obs.last_seen_at
    } else {
      g.entries.set(obs.packaging_id, { count: obs.count, lastSeenAt: obs.last_seen_at })
    }

    groups.set(obs.fingerprint, g)
  }

  // Resolve packaging names for all seen packaging_ids
  const allPackagingIds = new Set<string>()
  for (const g of groups.values()) {
    for (const id of g.entries.keys()) allPackagingIds.add(id)
  }
  const packagingNames = await fetchPackagingNames(Array.from(allPackagingIds))

  const rows: FingerprintStatsRow[] = []

  for (const group of groups.values()) {
    let dominantPackagingId: string | null = null
    let dominantCount = 0
    for (const [pkgId, { count }] of group.entries.entries()) {
      if (count > dominantCount) {
        dominantCount = count
        dominantPackagingId = pkgId
      }
    }

    const share = group.total === 0 ? 0 : dominantCount / group.total
    const distinctBoxCombos = group.entries.size
    const dominantBoxCombo =
      dominantPackagingId === null
        ? null
        : packagingNames.get(dominantPackagingId) ?? `packaging ${dominantPackagingId}`

    const suggestedAction = suggestActionV2({
      total: group.total,
      share,
      distinctBoxCombos,
    })

    // In the observation model the followRate mirrors the dominant-combo
    // share: consensus is the only signal, there is no advice outcome.
    const sharePct = share * 100

    rows.push({
      fingerprint: group.fingerprint,
      country: null,
      total: group.total,
      resolved: 0,
      followed: 0,
      modified: 0,
      ignored: 0,
      followRate: dominantPackagingId === null ? null : sharePct,
      dominantBoxCombo,
      dominantBoxComboShare: dominantPackagingId === null ? null : sharePct,
      distinctBoxCombos,
      avgAdviceCost: null,
      lastSeenAt: group.lastSeenAt,
      suggestedAction,
    })
  }

  return rows.sort((a, b) => b.total - a.total).slice(0, limit)
}

/**
 * V2 fingerprint detail — observation model.
 *
 * Uses two data sources:
 *   1. `packing_observations` for the aggregate stats + box-combo distribution
 *   2. `packing_sessions` + `packing_session_boxes` + `packing_session_products`
 *      for recent activity (last 20 sessions that match the fingerprint).
 *
 * Country is always null in V2 (the observation model is land-onafhankelijk),
 * but drill-down UIs can still derive country via
 * `packing_sessions.order_id → packaging_advice.country_code` — that join is
 * out of scope here and can be layered on later.
 */
export async function getFingerprintDetailV2(
  fingerprint: string,
): Promise<FingerprintDetailResult | null> {
  const observations = await fetchObservationsForFingerprint(fingerprint)

  // Aggregate per-packaging counts
  const byPackaging = new Map<string, { count: number; lastSeenAt: string }>()
  let total = 0
  let lastSeenAt: string | null = null

  for (const obs of observations) {
    total += obs.count
    if (lastSeenAt === null || obs.last_seen_at > lastSeenAt) lastSeenAt = obs.last_seen_at
    const existing = byPackaging.get(obs.packaging_id)
    if (existing) {
      existing.count += obs.count
      if (obs.last_seen_at > existing.lastSeenAt) existing.lastSeenAt = obs.last_seen_at
    } else {
      byPackaging.set(obs.packaging_id, {
        count: obs.count,
        lastSeenAt: obs.last_seen_at,
      })
    }
  }

  // Early exit when there is NO data anywhere — observations nor recent
  // sessions. We still attempt the session fallback below because a
  // fingerprint may be "rising" (has sessions) before observations landed.
  const packagingNames = await fetchPackagingNames(Array.from(byPackaging.keys()))

  let dominantPackagingId: string | null = null
  let dominantCount = 0
  for (const [pkgId, { count }] of byPackaging.entries()) {
    if (count > dominantCount) {
      dominantCount = count
      dominantPackagingId = pkgId
    }
  }

  const share = total === 0 ? 0 : dominantCount / total
  const distinctBoxCombos = byPackaging.size
  const dominantCombo =
    dominantPackagingId === null
      ? null
      : packagingNames.get(dominantPackagingId) ?? `packaging ${dominantPackagingId}`

  const boxCombos: FingerprintBoxCombo[] = Array.from(byPackaging.entries())
    .map(([pkgId, { count }]) => ({
      combo: packagingNames.get(pkgId) ?? `packaging ${pkgId}`,
      count,
      share: total === 0 ? 0 : (count / total) * 100,
      followed: 0,
      modified: 0,
      ignored: 0,
      avgAdviceCost: null,
    }))
    .sort((a, b) => b.count - a.count)

  // Recent activity — live query over sessions that match this fingerprint.
  // We filter client-side because building the product-fingerprint requires
  // joining boxes+products+product_attributes which PostgREST can't do in
  // one query. Session volumes are low enough that fetching the last 200
  // completed sessions and filtering in-memory is cheap.
  const recentRecords = await queryRecentSessionsForFingerprint(fingerprint)

  if (total === 0 && recentRecords.length === 0) return null

  const suggestedAction =
    total === 0
      ? 'rising'
      : suggestActionV2({ total, share, distinctBoxCombos })

  const sharePct = share * 100

  return {
    fingerprint,
    country: null,
    stats: {
      fingerprint,
      country: null,
      total,
      resolved: 0,
      followed: 0,
      modified: 0,
      ignored: 0,
      followRate: dominantPackagingId === null ? null : sharePct,
      dominantBoxCombo: dominantCombo,
      dominantBoxComboShare: dominantPackagingId === null ? null : sharePct,
      distinctBoxCombos,
      avgAdviceCost: null,
      lastSeenAt,
      suggestedAction,
    },
    boxCombos,
    recentRecords,
  }
}

/**
 * Live-query the last 20 completed packing sessions whose packed
 * product-fingerprint matches `fingerprint`. We can't filter the fingerprint
 * directly in SQL (it's derived from products+classification), so we:
 *   1. Pull the last 200 completed sessions
 *   2. Fetch their boxes + products + accompanying-classification bits
 *   3. Compute the fingerprint per session in-memory
 *   4. Keep only the matching sessions (max 20)
 *
 * Session volumes are low (hundreds per day), so this stays well under the
 * PostgREST URL limit and responds in tens of ms.
 */
async function queryRecentSessionsForFingerprint(
  fingerprint: string,
): Promise<FingerprintRecentRecord[]> {
  const { data: sessions, error: sessionsError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('id, picklist_id, order_id, completed_at')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(200)

  if (sessionsError) {
    console.warn('[insights V2] recent-sessions sessions query error:', sessionsError)
    return []
  }

  const sessionRows = sessions ?? []
  if (sessionRows.length === 0) return []

  const sessionIds = sessionRows.map((s) => s.id as string)

  // Fetch all boxes for those sessions
  const CHUNK_SIZE = 150
  const boxesBySession = new Map<
    string,
    Array<{ id: string; packaging_id: number | null; packaging_name: string | null }>
  >()
  const allBoxIds: string[] = []

  for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
    const chunk = sessionIds.slice(i, i + CHUNK_SIZE)
    const { data: boxes, error: boxesError } = await supabase
      .schema('batchmaker')
      .from('packing_session_boxes')
      .select('id, session_id, picqer_packaging_id')
      .in('session_id', chunk)
      .not('shipment_id', 'is', null)

    if (boxesError) {
      console.warn('[insights V2] recent-sessions boxes query error:', boxesError)
      continue
    }

    for (const b of boxes ?? []) {
      allBoxIds.push(b.id as string)
      const arr =
        boxesBySession.get(b.session_id as string) ??
        (boxesBySession.set(b.session_id as string, []).get(b.session_id as string) as Array<{
          id: string
          packaging_id: number | null
          packaging_name: string | null
        }>)
      arr.push({
        id: b.id as string,
        packaging_id: (b.picqer_packaging_id as number | null) ?? null,
        packaging_name: null,
      })
    }
  }

  if (allBoxIds.length === 0) return []

  // Fetch all products for those boxes
  const productsByBox = new Map<
    string,
    Array<{ productcode: string; picqer_product_id: number; amount: number }>
  >()

  for (let i = 0; i < allBoxIds.length; i += CHUNK_SIZE) {
    const chunk = allBoxIds.slice(i, i + CHUNK_SIZE)
    const { data: products, error: productsError } = await supabase
      .schema('batchmaker')
      .from('packing_session_products')
      .select('box_id, picqer_product_id, productcode, amount')
      .in('box_id', chunk)

    if (productsError) {
      console.warn('[insights V2] recent-sessions products query error:', productsError)
      continue
    }

    for (const p of products ?? []) {
      const arr =
        productsByBox.get(p.box_id as string) ??
        (productsByBox.set(p.box_id as string, []).get(p.box_id as string) as Array<{
          productcode: string
          picqer_product_id: number
          amount: number
        }>)
      arr.push({
        productcode: p.productcode as string,
        picqer_product_id: p.picqer_product_id as number,
        amount: p.amount as number,
      })
    }
  }

  // Fetch product attributes for the accompanying-filter (shared across sessions)
  const allProductIds = new Set<number>()
  for (const arr of productsByBox.values()) {
    for (const p of arr) allProductIds.add(p.picqer_product_id)
  }

  const productAttrs = await fetchProductAttributes(Array.from(allProductIds))

  // Build a fingerprint for each session, filter accompanying products out
  const matchingRecords: FingerprintRecentRecord[] = []

  for (const s of sessionRows) {
    const sessionBoxes = boxesBySession.get(s.id as string) ?? []
    if (sessionBoxes.length === 0) continue

    const sessionProducts: Array<{ productcode: string; picqer_product_id: number; amount: number }> = []
    for (const box of sessionBoxes) {
      const ps = productsByBox.get(box.id) ?? []
      sessionProducts.push(...ps)
    }

    if (sessionProducts.length === 0) continue

    const coreProducts = sessionProducts.filter(
      (p) => !isAccompanyingProduct(p.productcode, productAttrs.get(p.picqer_product_id)),
    )

    const sessionFingerprint = buildProductFingerprintFromBoxes(coreProducts)
    if (sessionFingerprint !== fingerprint) continue

    matchingRecords.push({
      id: s.id as string,
      order_id: (s.order_id as number | null) ?? 0,
      picklist_id: (s.picklist_id as number | null) ?? null,
      confidence: 'full_match', // observation model has no confidence enum — default
      outcome: null,
      adviceBoxes: [],
      actualBoxes: sessionBoxes.map((b) =>
        b.packaging_id == null ? '?' : String(b.packaging_id),
      ),
      calculated_at: (s.completed_at as string | null) ?? new Date().toISOString(),
    })

    if (matchingRecords.length >= 20) break
  }

  // Resolve Picqer packaging ids → packaging names so actualBoxes are human-readable.
  // NB: packing_session_boxes.picqer_packaging_id matches packagings.idpackaging
  // (bigint from Picqer), not packagings.id (uuid). See patternLearner.ts:165-173.
  const allPicqerIdsUsed = new Set<string>()
  for (const rec of matchingRecords) {
    for (const b of rec.actualBoxes) {
      if (b && b !== '?') allPicqerIdsUsed.add(b)
    }
  }
  const pkgNames = await fetchPackagingNamesByPicqerId(Array.from(allPicqerIdsUsed))

  return matchingRecords.map((r) => ({
    ...r,
    actualBoxes: r.actualBoxes.map((id) => pkgNames.get(id) ?? id),
  }))
}

/**
 * Resolve `packagings.idpackaging` (Picqer numeric id) → `packagings.name`.
 * Kept separate from `fetchPackagingNames` (which keys on the uuid) because
 * session boxes store the Picqer id, not the local uuid.
 */
async function fetchPackagingNamesByPicqerId(
  picqerIds: string[],
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(picqerIds.map((s) => String(s)).filter((s) => s.length > 0)),
  )
  if (unique.length === 0) return new Map()

  const CHUNK_SIZE = 150
  const map = new Map<string, string>()

  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE)
    // `idpackaging` is bigint in the DB, so pass numeric values.
    const numericChunk = chunk.map((s) => Number(s)).filter((n) => Number.isFinite(n))
    if (numericChunk.length === 0) continue

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('idpackaging, name')
      .in('idpackaging', numericChunk)

    if (error) {
      console.warn('[insights V2] fetchPackagingNamesByPicqerId chunk error:', error)
      continue
    }

    for (const row of data ?? []) {
      if (row.idpackaging && row.name) {
        map.set(String(row.idpackaging), row.name as string)
      }
    }
  }

  return map
}

/**
 * Mirrors isAccompanying() from packagingEngine / simpleAdvice POC. Kept
 * inline so insights.ts stays self-contained and doesn't pull in the full
 * classification module.
 */
const NON_SHIPPABLE_LOGISTICS_V2 = new Set(['100000011', '100000012', '100000013'])

function isAccompanyingProduct(
  productcode: string,
  attr: { product_type: string | null; classification_status: string | null } | undefined,
): boolean {
  const type = attr?.product_type?.toLowerCase() ?? null
  if (type === 'accessoire') return true
  if (type === 'onbekend' && attr?.classification_status === 'missing_data') return true
  if (/^[0-9]{1,3}$/.test(productcode)) return true
  if (NON_SHIPPABLE_LOGISTICS_V2.has(productcode)) return true
  return false
}

async function fetchProductAttributes(
  productIds: number[],
): Promise<
  Map<number, { product_type: string | null; classification_status: string | null }>
> {
  const map = new Map<
    number,
    { product_type: string | null; classification_status: string | null }
  >()
  if (productIds.length === 0) return map

  const CHUNK_SIZE = 150
  for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
    const chunk = productIds.slice(i, i + CHUNK_SIZE)
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('picqer_product_id, product_type, classification_status')
      .in('picqer_product_id', chunk)

    if (error) {
      console.warn('[insights V2] fetchProductAttributes chunk error:', error)
      continue
    }

    for (const row of data ?? []) {
      map.set(row.picqer_product_id as number, {
        product_type: (row.product_type as string | null) ?? null,
        classification_status: (row.classification_status as string | null) ?? null,
      })
    }
  }

  return map
}

/**
 * Build a deterministic `productcode:qty|productcode:qty` fingerprint for
 * the provided core products (accompanying already filtered out). Mirrors
 * `buildProductFingerprint` in simpleAdvice POC.
 */
function buildProductFingerprintFromBoxes(
  products: Array<{ productcode: string; amount: number }>,
): string {
  const byCode = new Map<string, number>()
  for (const p of products) {
    byCode.set(p.productcode, (byCode.get(p.productcode) ?? 0) + p.amount)
  }
  return Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, qty]) => `${code}:${qty}`)
    .join('|')
}

