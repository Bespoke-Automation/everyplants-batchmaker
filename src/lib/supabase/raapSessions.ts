import { supabase } from './client'
import type { RaapCategory } from './raapCategoryLocations'

export interface RaapSession {
  id: string
  category: RaapCategory
  vervoerder_id: string | null
  status: 'active' | 'completed'
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface RaapSessionItem {
  id: string
  session_id: string
  product_id: number
  productcode: string
  product_name: string
  location: string
  qty_needed: number
  qty_picked: number
  checked: boolean
  created_at: string
  updated_at: string
}

/** Get active session for a category+vervoerder combination, if one exists */
export async function getActiveSession(
  category: RaapCategory,
  vervoerder_id: string | null = null
): Promise<RaapSession | null> {
  let query = supabase
    .schema('batchmaker')
    .from('raap_sessions')
    .select('*')
    .eq('category', category)
    .eq('status', 'active')

  if (vervoerder_id) {
    query = query.eq('vervoerder_id', vervoerder_id)
  } else {
    query = query.is('vervoerder_id', null)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}

/** Create a new session, auto-completing any existing active session for the same category+vervoerder */
export async function createSession(
  category: RaapCategory,
  vervoerder_id: string | null = null
): Promise<RaapSession> {
  // Auto-complete any existing active session for this combination
  let completeQuery = supabase
    .schema('batchmaker')
    .from('raap_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('category', category)
    .eq('status', 'active')

  if (vervoerder_id) {
    completeQuery = completeQuery.eq('vervoerder_id', vervoerder_id)
  } else {
    completeQuery = completeQuery.is('vervoerder_id', null)
  }

  await completeQuery

  // Create new session
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('raap_sessions')
    .insert({
      category,
      vervoerder_id: vervoerder_id || null,
      status: 'active',
    })
    .select('*')
    .single()

  if (error) throw error
  return data
}

export async function completeSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('raap_sessions')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (error) throw error
}

export async function getSessionItems(sessionId: string): Promise<RaapSessionItem[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('raap_session_items')
    .select('*')
    .eq('session_id', sessionId)
    .order('location')

  if (error) throw error
  return data || []
}

export async function upsertSessionItems(
  sessionId: string,
  items: Omit<RaapSessionItem, 'id' | 'session_id' | 'created_at' | 'updated_at'>[]
): Promise<void> {
  // Replace all items for this session
  await supabase
    .schema('batchmaker')
    .from('raap_session_items')
    .delete()
    .eq('session_id', sessionId)

  if (items.length === 0) return

  const { error } = await supabase
    .schema('batchmaker')
    .from('raap_session_items')
    .insert(items.map(item => ({ ...item, session_id: sessionId })))

  if (error) throw error
}
