import { supabase } from '@/lib/supabase/client'

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

// getWorkerStats was removed in review (B3): the was_override semantics
// didn't match "override rate" and the endpoint wasn't wired to any UI.
// Worker-level compliance should aggregate packaging_advice.outcome on
// the session level — to be re-implemented in Fase 3 with the proper math.
