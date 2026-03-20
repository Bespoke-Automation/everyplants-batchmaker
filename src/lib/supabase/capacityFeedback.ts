import { supabase } from './client'
import { upsertBoxCapacity } from './boxCapacities'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CapacityFeedbackRow {
  id: string
  packaging_id: string
  shipping_unit_id: string
  observed_quantity: number
  times_seen: number
  status: 'pending' | 'auto_approved' | 'approved' | 'rejected'
  last_session_id: string | null
  approved_at: string | null
  approved_by: string | null
  created_at: string
  updated_at: string
  // Joined
  packaging_name?: string
  shipping_unit_name?: string
}

export interface CoverageLogRow {
  id: string
  order_id: number
  picklist_id: number | null
  country_code: string | null
  confidence: string
  total_shipping_units: number
  uncovered_unit_ids: string[]
  uncovered_unit_names: string[]
  total_cost: number | null
  created_at: string
}

const AUTO_APPROVE_THRESHOLD = 3

// ── Feedback CRUD ────────────────────────────────────────────────────────────

export async function getCapacityFeedback(status?: string): Promise<CapacityFeedbackRow[]> {
  let query = supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .select(`
      *,
      packagings!capacity_feedback_packaging_id_fkey ( name ),
      shipping_units!capacity_feedback_shipping_unit_id_fkey ( name )
    `)
    .order('times_seen', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) throw error

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    packaging_id: row.packaging_id as string,
    shipping_unit_id: row.shipping_unit_id as string,
    observed_quantity: row.observed_quantity as number,
    times_seen: row.times_seen as number,
    status: row.status as CapacityFeedbackRow['status'],
    last_session_id: row.last_session_id as string | null,
    approved_at: row.approved_at as string | null,
    approved_by: row.approved_by as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    packaging_name: (row.packagings as { name: string } | null)?.name,
    shipping_unit_name: (row.shipping_units as { name: string } | null)?.name,
  }))
}

/**
 * Record an observed capacity from a packing session.
 * If this combination was seen before, increment times_seen and update observed_quantity
 * to the MAX of old and new. Auto-approve if threshold is reached.
 */
export async function recordCapacityObservation(
  packagingId: string,
  shippingUnitId: string,
  observedQuantity: number,
  sessionId: string
): Promise<CapacityFeedbackRow> {
  // Check if feedback already exists for this combination
  const { data: existing } = await supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .select('id, observed_quantity, times_seen, status')
    .eq('packaging_id', packagingId)
    .eq('shipping_unit_id', shippingUnitId)
    .maybeSingle()

  if (existing) {
    const newTimesSeen = existing.times_seen + 1
    const newQuantity = Math.max(existing.observed_quantity, observedQuantity)
    const shouldAutoApprove = newTimesSeen >= AUTO_APPROVE_THRESHOLD && existing.status === 'pending'

    const { data, error } = await supabase
      .schema('batchmaker')
      .from('capacity_feedback')
      .update({
        observed_quantity: newQuantity,
        times_seen: newTimesSeen,
        last_session_id: sessionId,
        ...(shouldAutoApprove ? {
          status: 'auto_approved',
          approved_at: new Date().toISOString(),
          approved_by: 'system (auto)',
        } : {}),
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw error

    // Auto-approve: also upsert into box_capacities
    if (shouldAutoApprove) {
      await applyFeedbackToCapacities(packagingId, shippingUnitId, newQuantity)
    }

    return data as CapacityFeedbackRow
  }

  // New observation
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .insert({
      packaging_id: packagingId,
      shipping_unit_id: shippingUnitId,
      observed_quantity: observedQuantity,
      times_seen: 1,
      status: 'pending',
      last_session_id: sessionId,
    })
    .select()
    .single()

  if (error) throw error
  return data as CapacityFeedbackRow
}

/**
 * Approve a pending feedback entry and apply it to box_capacities
 */
export async function approveFeedback(id: string, approvedBy: string): Promise<void> {
  const { data: feedback, error: fetchError } = await supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .select('packaging_id, shipping_unit_id, observed_quantity')
    .eq('id', id)
    .single()

  if (fetchError) throw fetchError

  const { error: updateError } = await supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq('id', id)

  if (updateError) throw updateError

  await applyFeedbackToCapacities(
    feedback.packaging_id,
    feedback.shipping_unit_id,
    feedback.observed_quantity
  )
}

/**
 * Reject a feedback entry
 */
export async function rejectFeedback(id: string, rejectedBy: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('capacity_feedback')
    .update({
      status: 'rejected',
      approved_at: new Date().toISOString(),
      approved_by: rejectedBy,
    })
    .eq('id', id)

  if (error) throw error
}

// ── Coverage Log ─────────────────────────────────────────────────────────────

export async function logAdviceCoverage(entry: {
  orderId: number
  picklistId?: number
  countryCode?: string
  confidence: string
  totalShippingUnits: number
  uncoveredUnitIds?: string[]
  uncoveredUnitNames?: string[]
  totalCost?: number
}): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('advice_coverage_log')
    .insert({
      order_id: entry.orderId,
      picklist_id: entry.picklistId ?? null,
      country_code: entry.countryCode ?? null,
      confidence: entry.confidence,
      total_shipping_units: entry.totalShippingUnits,
      uncovered_unit_ids: entry.uncoveredUnitIds ?? [],
      uncovered_unit_names: entry.uncoveredUnitNames ?? [],
      total_cost: entry.totalCost ?? null,
    })

  if (error) {
    console.error('[capacityFeedback] Error logging coverage:', error)
    // Non-fatal: don't throw
  }
}

export async function getCoverageStats(days: number = 7): Promise<{
  total: number
  fullMatch: number
  partialMatch: number
  noMatch: number
  topUncoveredUnits: { name: string; count: number }[]
}> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('advice_coverage_log')
    .select('confidence, uncovered_unit_names')
    .gte('created_at', since)

  if (error) throw error

  const rows = data || []
  const total = rows.length
  const fullMatch = rows.filter(r => r.confidence === 'full_match').length
  const partialMatch = rows.filter(r => r.confidence === 'partial_match').length
  const noMatch = rows.filter(r => r.confidence === 'no_match').length

  // Count uncovered units across all no_match/partial_match entries
  const unitCounts: Record<string, number> = {}
  for (const row of rows) {
    const names = row.uncovered_unit_names as string[] | null
    if (names) {
      for (const name of names) {
        unitCounts[name] = (unitCounts[name] || 0) + 1
      }
    }
  }

  const topUncoveredUnits = Object.entries(unitCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return { total, fullMatch, partialMatch, noMatch, topUncoveredUnits }
}

// ── Internal ─────────────────────────────────────────────────────────────────

async function applyFeedbackToCapacities(
  packagingId: string,
  shippingUnitId: string,
  maxQuantity: number
): Promise<void> {
  try {
    await upsertBoxCapacity(packagingId, shippingUnitId, maxQuantity)
  } catch (error) {
    console.error('[capacityFeedback] Error applying to box_capacities:', error)
  }
}
