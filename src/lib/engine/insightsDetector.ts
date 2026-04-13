/**
 * Insights Action Detector — scans the engine data for improvement
 * opportunities and upserts them into the insights_actions table.
 *
 * Can be triggered manually via the UI or by a nightly cron. Each detection
 * uses a deterministic dedupe_key so repeated runs update existing actions
 * rather than creating duplicates.
 *
 * Detection types:
 *   1. drifting_pattern — active learned patterns with rising override ratio
 *   2. no_match_fingerprint — shipping-unit fingerprints with no engine advice
 *   3. unclassified_products — products the engine can't classify
 *   4. newly_promoted — patterns promoted to active in the last 7 days (informational)
 */

import { supabase } from '@/lib/supabase/client'
import { getEngineSettings } from './engineSettings'
import { upsertAction, type UpsertActionInput } from './insightsActions'
import { INSIGHTS_WINDOW_DAYS } from './insights'

export interface DetectionResult {
  detected: number
  byType: Record<string, number>
}

/**
 * Run all detectors and upsert found actions. Returns counts per type.
 */
export async function detectInsightsActions(): Promise<DetectionResult> {
  const actions: UpsertActionInput[] = []

  const [drifting, noMatch, unclassified, promoted] = await Promise.all([
    detectDriftingPatterns(),
    detectNoMatchFingerprints(),
    detectUnclassifiedProducts(),
    detectNewlyPromoted(),
  ])

  actions.push(...drifting, ...noMatch, ...unclassified, ...promoted)

  // Upsert all detected actions
  for (const action of actions) {
    await upsertAction(action)
  }

  // Count by type
  const byType: Record<string, number> = {}
  for (const a of actions) {
    byType[a.type] = (byType[a.type] ?? 0) + 1
  }

  return { detected: actions.length, byType }
}

// ── Detectors ────────────────────────────────────────────────────────────────

/**
 * Detect active patterns where the override ratio is approaching or exceeding
 * the invalidation threshold. These need human review — workers are consistently
 * overriding the engine's recommendation.
 */
async function detectDriftingPatterns(): Promise<UpsertActionInput[]> {
  const settings = await getEngineSettings()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('id, fingerprint, times_seen, times_overridden, box_pattern')
    .eq('status', 'active')

  if (error) {
    console.error('[insightsDetector] drifting patterns query error:', error)
    return []
  }

  const actions: UpsertActionInput[] = []

  for (const row of data ?? []) {
    const total = (row.times_seen as number) + (row.times_overridden as number)
    if (total < settings.invalidation_min_observations) continue

    const overrideRatio = (row.times_overridden as number) / total
    const warningThreshold = Math.max(0, settings.invalidation_override_ratio - 0.2)

    if (overrideRatio >= warningThreshold) {
      const pct = (overrideRatio * 100).toFixed(0)
      const fp = row.fingerprint as string

      actions.push({
        type: 'drifting_pattern',
        dedupe_key: `drifting_pattern:${row.id}`,
        fingerprint: fp,
        title: `Patroon wordt genegeerd (${pct}% override)`,
        description: `Dit actieve patroon heeft een override ratio van ${pct}%. Medewerkers kiezen consequent een andere verpakking. Overweeg het patroon te deactiveren of de verpakking te herzien.`,
        payload: {
          pattern_id: row.id,
          override_ratio: overrideRatio,
          times_seen: row.times_seen,
          times_overridden: row.times_overridden,
        },
        impact_score: overrideRatio * 10, // higher override = more impactful to fix
        volume: total,
      })
    }
  }

  return actions
}

/**
 * Detect shipping-unit fingerprints where the engine consistently has no match
 * (confidence = no_match) but workers DID pack orders. These are candidates
 * for new compartment rules.
 */
async function detectNoMatchFingerprints(): Promise<UpsertActionInput[]> {
  const windowStart = new Date(
    Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('shipping_unit_fingerprint, country_code')
    .eq('confidence', 'no_match')
    .not('shipping_unit_fingerprint', 'is', null)
    .gte('calculated_at', windowStart)

  if (error) {
    console.error('[insightsDetector] no_match fingerprints query error:', error)
    return []
  }

  // Group by fingerprint + country, count volume
  const groups = new Map<string, { fp: string; country: string | null; count: number }>()
  for (const row of data ?? []) {
    const fp = row.shipping_unit_fingerprint as string
    const country = (row.country_code as string | null) ?? null
    const key = `${fp}::${country ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.count++
    } else {
      groups.set(key, { fp, country, count: 1 })
    }
  }

  const actions: UpsertActionInput[] = []
  const MIN_VOLUME = 5

  for (const { fp, country, count } of groups.values()) {
    if (count < MIN_VOLUME) continue

    actions.push({
      type: 'no_match_fingerprint',
      dedupe_key: `no_match:${fp}:${country ?? ''}`,
      fingerprint: fp,
      country,
      title: `Geen advies voor ${fp.split('|')[0] || fp} (${count}×)`,
      description: `De engine heeft geen compartment rule voor dit shipping-unit patroon. ${count} orders in de laatste ${INSIGHTS_WINDOW_DAYS} dagen hadden geen advies. Overweeg een nieuwe regel toe te voegen.`,
      payload: { volume_last_window: count },
      impact_score: Math.min(5, count / 10), // caps at 5
      volume: count,
    })
  }

  return actions
}

/**
 * Detect products that the engine can't classify (unclassified_products field
 * is not empty). These need product attribute data in Picqer.
 */
async function detectUnclassifiedProducts(): Promise<UpsertActionInput[]> {
  const windowStart = new Date(
    Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packaging_advice')
    .select('unclassified_products')
    .gte('calculated_at', windowStart)
    .not('unclassified_products', 'is', null)

  if (error) {
    console.error('[insightsDetector] unclassified products query error:', error)
    return []
  }

  // Collect all unclassified productcodes and their frequency
  const productCounts = new Map<string, number>()
  for (const row of data ?? []) {
    const products = row.unclassified_products as string[] | null
    if (!Array.isArray(products)) continue
    for (const code of products) {
      if (typeof code === 'string' && code.trim()) {
        productCounts.set(code, (productCounts.get(code) ?? 0) + 1)
      }
    }
  }

  if (productCounts.size === 0) return []

  // Group into one action with the top unclassified products
  const sorted = Array.from(productCounts.entries()).sort((a, b) => b[1] - a[1])
  const topProducts = sorted.slice(0, 10)
  const totalAffected = sorted.reduce((sum, [, count]) => sum + count, 0)

  return [
    {
      type: 'unclassified_products',
      dedupe_key: 'unclassified_products:global',
      title: `${productCounts.size} producten zonder classificatie`,
      description: `Deze producten missen potmaat, hoogte of producttype in Picqer. Hierdoor valt de engine terug op een default advies. Voeg de ontbrekende gegevens toe in Picqer.`,
      payload: {
        products: topProducts.map(([code, count]) => ({ productcode: code, affected_orders: count })),
        total_unclassified: productCounts.size,
      },
      impact_score: Math.min(5, productCounts.size / 5),
      volume: totalAffected,
    },
  ]
}

/**
 * Detect patterns promoted to active in the last 7 days. Informational —
 * lets the operator know the system is learning.
 */
async function detectNewlyPromoted(): Promise<UpsertActionInput[]> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('learned_packing_patterns')
    .select('id, fingerprint, promoted_at, times_seen')
    .eq('status', 'active')
    .gte('promoted_at', oneWeekAgo)
    .order('promoted_at', { ascending: false })

  if (error) {
    console.error('[insightsDetector] newly promoted query error:', error)
    return []
  }

  if (!data || data.length === 0) return []

  // One summary action for all recently promoted patterns
  return [
    {
      type: 'newly_promoted',
      dedupe_key: `newly_promoted:week:${oneWeekAgo.slice(0, 10)}`,
      title: `${data.length} ${data.length === 1 ? 'nieuw patroon' : 'nieuwe patronen'} geleerd deze week`,
      description: `Het systeem heeft ${data.length} inpakpatronen gepromoveerd naar actief op basis van consistente observaties. Deze worden nu gebruikt in het advies.`,
      payload: {
        pattern_ids: data.map((r) => r.id),
        count: data.length,
      },
      impact_score: 0, // informational — no action needed
      volume: data.reduce((sum, r) => sum + (r.times_seen as number), 0),
    },
  ]
}
