import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export type BatchSessionStatus = 'claimed' | 'in_progress' | 'completed' | 'failed'

export interface PackingBatchSession {
  id: string
  batch_id: number
  batch_display_id: string | null
  total_picklists: number
  completed_picklists: number
  assigned_to: number
  assigned_to_name: string
  status: BatchSessionStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

// ── Batch Session CRUD ───────────────────────────────────────────────────────

/**
 * Create a batch session (claim a batch).
 * If the same worker already has an active session for this batch, return it (doorgaan flow).
 */
export async function createBatchSession(
  batchId: number,
  displayId: string,
  totalPicklists: number,
  workerId: number,
  workerName: string
): Promise<PackingBatchSession> {
  // Check if an active session already exists for this batch
  const { data: existing, error: checkError } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select()
    .eq('batch_id', batchId)
    .not('status', 'in', '("completed","failed")')
    .limit(1)
    .maybeSingle()

  if (checkError) {
    console.error('Error checking existing batch session:', checkError)
    throw checkError
  }

  if (existing) {
    // Same worker → return existing (doorgaan)
    if (existing.assigned_to === workerId) {
      return existing
    }
    throw new Error(`Batch ${batchId} is already claimed by ${existing.assigned_to_name}`)
  }

  // Create new batch session
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .insert({
      batch_id: batchId,
      batch_display_id: displayId,
      total_picklists: totalPicklists,
      completed_picklists: 0,
      assigned_to: workerId,
      assigned_to_name: workerName,
      status: 'claimed',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating batch session:', error)
    throw error
  }

  return data
}

/**
 * Get a batch session by ID
 */
export async function getBatchSession(id: string): Promise<PackingBatchSession> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select()
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching batch session:', error)
    throw error
  }

  return data
}

/**
 * Update a batch session
 */
export async function updateBatchSession(
  id: string,
  updates: Partial<Omit<PackingBatchSession, 'id' | 'created_at' | 'updated_at'>>
): Promise<PackingBatchSession> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating batch session:', error)
    throw error
  }

  return data
}

/**
 * Get active batch session for a worker (status NOT IN completed, failed)
 */
export async function getActiveBatchSessionForWorker(workerId: number): Promise<PackingBatchSession | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select()
    .eq('assigned_to', workerId)
    .not('status', 'in', '("completed","failed")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Error fetching active batch session for worker:', error)
    throw error
  }

  return data
}

/**
 * Increment completed picklists counter.
 * If all picklists are completed, mark batch session as completed.
 */
export async function incrementCompletedPicklists(batchSessionId: string): Promise<PackingBatchSession> {
  // Get current state
  const session = await getBatchSession(batchSessionId)

  const newCount = session.completed_picklists + 1
  const isComplete = newCount >= session.total_picklists

  const updates: Partial<PackingBatchSession> = {
    completed_picklists: newCount,
    status: isComplete ? 'completed' : 'in_progress',
  }

  if (isComplete) {
    updates.completed_at = new Date().toISOString()
  }

  return updateBatchSession(batchSessionId, updates)
}

/**
 * Get all active batch sessions (for queue enrichment)
 */
export async function getActiveBatchSessions(): Promise<PackingBatchSession[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select()
    .not('status', 'in', '("completed","failed")')

  if (error) {
    console.error('Error fetching active batch sessions:', error)
    throw error
  }

  return data || []
}

/**
 * Get packing sessions linked to a batch session
 */
export async function getPackingSessionsForBatch(batchSessionId: string) {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select()
    .eq('batch_session_id', batchSessionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching packing sessions for batch:', error)
    throw error
  }

  return data || []
}

/**
 * Get batch session history with pagination
 */
export async function getBatchSessionHistory(
  options?: { limit?: number; offset?: number }
): Promise<{ sessions: PackingBatchSession[]; total: number }> {
  const limit = options?.limit ?? 20
  const offset = options?.offset ?? 0

  const { count, error: countError } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Error fetching batch session count:', countError)
    throw countError
  }

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_batch_sessions')
    .select()
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching batch session history:', error)
    throw error
  }

  return {
    sessions: data || [],
    total: count || 0,
  }
}
