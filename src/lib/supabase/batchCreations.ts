import { supabase } from './client'
import type { BatchCreation, BatchCreationInsert } from '@/types/database'

/**
 * Insert a new batch creation record
 */
export async function createBatchCreation(data: BatchCreationInsert): Promise<BatchCreation> {
  const { data: record, error } = await supabase
    .schema('batchmaker')
    .from('batch_creations')
    .insert({
      picqer_batch_id: data.picqer_batch_id,
      picklist_count: data.picklist_count,
      pps_filter: data.pps_filter,
      webhook_triggered: data.webhook_triggered,
      status: data.status,
      error_message: data.error_message,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating batch creation record:', error)
    throw error
  }

  return record
}

/**
 * Get recent batch creations, ordered by most recent first
 */
export async function getRecentBatchCreations(limit: number = 5): Promise<BatchCreation[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('batch_creations')
    .select()
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching recent batch creations:', error)
    throw error
  }

  return data || []
}
