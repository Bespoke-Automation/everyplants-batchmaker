/**
 * CRUD helpers for batchmaker.insights_actions — the action queue that
 * surfaces improvement opportunities detected by the nightly scanner.
 */

import { supabase } from '@/lib/supabase/client'

export type InsightActionType =
  | 'drifting_pattern'
  | 'no_match_fingerprint'
  | 'unclassified_products'
  | 'newly_promoted'

export type InsightActionStatus = 'open' | 'snoozed' | 'completed' | 'dismissed'

export interface InsightAction {
  id: string
  type: InsightActionType
  dedupe_key: string
  fingerprint: string | null
  country: string | null
  title: string
  description: string | null
  payload: Record<string, unknown>
  impact_score: number
  volume: number
  status: InsightActionStatus
  snoozed_until: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
  resolved_by: string | null
}

export interface UpsertActionInput {
  type: InsightActionType
  dedupe_key: string
  fingerprint?: string | null
  country?: string | null
  title: string
  description?: string | null
  payload?: Record<string, unknown>
  impact_score: number
  volume: number
}

/**
 * List actions filtered by status. Expired snoozes are treated as open.
 * Returns top N by impact_score desc.
 */
export async function listActions(
  status: InsightActionStatus | 'active' = 'active',
  limit = 10,
): Promise<InsightAction[]> {
  const now = new Date().toISOString()

  if (status === 'active') {
    // "active" = open + snoozed-but-expired
    const { data, error } = await supabase
      .schema('batchmaker')
      .from('insights_actions')
      .select('*')
      .or(`status.eq.open,and(status.eq.snoozed,snoozed_until.lt.${now})`)
      .order('impact_score', { ascending: false })
      .limit(limit)

    if (error) throw error
    return (data ?? []) as InsightAction[]
  }

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .select('*')
    .eq('status', status)
    .order('impact_score', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as InsightAction[]
}

/**
 * Upsert an action. Uses dedupe_key to prevent duplicates — if the same
 * action already exists, update its impact_score and volume (the detection
 * may produce updated numbers on each run). Status is NOT overwritten so
 * a snoozed/dismissed action stays that way.
 */
export async function upsertAction(input: UpsertActionInput): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .upsert(
      {
        type: input.type,
        dedupe_key: input.dedupe_key,
        fingerprint: input.fingerprint ?? null,
        country: input.country ?? null,
        title: input.title,
        description: input.description ?? null,
        payload: input.payload ?? {},
        impact_score: input.impact_score,
        volume: input.volume,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'dedupe_key',
        ignoreDuplicates: false,
      },
    )

  if (error) throw error

  // After upsert, update ONLY impact_score + volume on existing rows
  // (the upsert above would overwrite status to 'open' for existing rows).
  // Fix: use a raw update for the "already exists" case.
  await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .update({
      impact_score: input.impact_score,
      volume: input.volume,
      title: input.title,
      description: input.description ?? null,
      payload: input.payload ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq('dedupe_key', input.dedupe_key)
    .in('status', ['snoozed', 'completed', 'dismissed'])
}

/**
 * Snooze an action for a given duration.
 */
export async function snoozeAction(
  id: string,
  duration: '24h' | '7d' | 'forever',
): Promise<void> {
  const now = new Date()
  let snoozedUntil: string

  switch (duration) {
    case '24h':
      snoozedUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
      break
    case '7d':
      snoozedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
      break
    case 'forever':
      snoozedUntil = new Date('2099-12-31').toISOString()
      break
  }

  const { error } = await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .update({
      status: 'snoozed',
      snoozed_until: snoozedUntil,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
}

/**
 * Mark an action as completed (the operator performed the suggested action).
 */
export async function completeAction(id: string, resolvedBy?: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .update({
      status: 'completed',
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
}

/**
 * Dismiss an action (operator reviewed it and decided it's not actionable).
 */
export async function dismissAction(id: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('insights_actions')
    .update({
      status: 'dismissed',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) throw error
}
