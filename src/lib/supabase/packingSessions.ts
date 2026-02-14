import { supabase } from './client'

// ── Types ────────────────────────────────────────────────────────────────────

export type PackingSessionStatus = 'claimed' | 'assigned' | 'packing' | 'shipping' | 'completed' | 'failed'
export type BoxShipmentStatus = 'pending' | 'open' | 'closed' | 'shipment_created' | 'label_fetched' | 'shipping' | 'shipped' | 'error'

export interface PackingSession {
  id: string
  picklist_id: number
  picklistid: string
  order_id: number | null
  order_reference: string | null
  retailer: string | null
  delivery_country: string | null
  assigned_to: number
  assigned_to_name: string
  status: PackingSessionStatus
  lock_expires_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface PackingSessionBox {
  id: string
  session_id: string
  picqer_packaging_id: number | null
  packaging_name: string
  packaging_barcode: string | null
  box_index: number
  shipment_id: number | null
  tracking_code: string | null
  tracking_url: string | null
  label_url: string | null
  shipped_at: string | null
  status: BoxShipmentStatus
  packaging_advice_id: string | null
  suggested_packaging_id: number | null
  suggested_packaging_name: string | null
  was_override: boolean
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface PackingSessionProduct {
  id: string
  session_id: string
  box_id: string
  picqer_product_id: number
  productcode: string
  product_name: string
  amount: number
  weight_per_unit: number | null
  created_at: string
  updated_at: string
}

export interface PackingSessionWithDetails extends PackingSession {
  packing_session_boxes: (PackingSessionBox & {
    packing_session_products: PackingSessionProduct[]
  })[]
}

// ── Input types ──────────────────────────────────────────────────────────────

export interface CreatePackingSessionInput {
  picklist_id: number
  picklistid: string
  order_id?: number
  order_reference?: string
  retailer?: string
  delivery_country?: string
  assigned_to: number
  assigned_to_name: string
}

export interface AddBoxInput {
  picqer_packaging_id?: number
  packaging_name: string
  packaging_barcode?: string
  box_index: number
  packaging_advice_id?: string
  suggested_packaging_id?: number
  suggested_packaging_name?: string
}

export interface AssignProductInput {
  session_id: string
  box_id: string
  picqer_product_id: number
  productcode: string
  product_name: string
  amount: number
  weight_per_unit?: number
}

export interface BoxShipmentData {
  shipment_id: number
  tracking_code?: string
  label_url?: string
  status: BoxShipmentStatus
}

// ── Session CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new packing session
 */
export async function createPackingSession(input: CreatePackingSessionInput): Promise<PackingSession> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .insert({
      picklist_id: input.picklist_id,
      picklistid: input.picklistid,
      order_id: input.order_id,
      order_reference: input.order_reference,
      retailer: input.retailer,
      delivery_country: input.delivery_country,
      assigned_to: input.assigned_to,
      assigned_to_name: input.assigned_to_name,
      status: 'claimed',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating packing session:', error)
    throw error
  }

  return data
}

/**
 * Get a packing session by ID, including boxes and products
 */
export async function getPackingSession(id: string): Promise<PackingSessionWithDetails> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select(`
      *,
      packing_session_boxes (
        *,
        packing_session_products (*)
      )
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching packing session:', error)
    throw error
  }

  return data
}

/**
 * Get active session for a worker (status NOT IN completed, failed)
 */
export async function getActiveSessionForWorker(workerId: number): Promise<PackingSession | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select()
    .eq('assigned_to', workerId)
    .not('status', 'in', '("completed","failed")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('Error fetching active session for worker:', error)
    throw error
  }

  return data
}

/**
 * Update a packing session
 */
export async function updatePackingSession(
  id: string,
  updates: Partial<Omit<PackingSession, 'id' | 'created_at' | 'updated_at'>>
): Promise<PackingSession> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating packing session:', error)
    throw error
  }

  return data
}

/**
 * Claim a picklist for packing (atomic: check not already claimed, then insert)
 */
export async function claimPicklist(
  picklistId: number,
  workerId: number,
  workerName: string
): Promise<PackingSession> {
  // Check if an active session already exists for this picklist
  const { data: existing, error: checkError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select()
    .eq('picklist_id', picklistId)
    .not('status', 'in', '("completed","failed")')
    .or('lock_expires_at.gt.now(),lock_expires_at.is.null')
    .limit(1)
    .maybeSingle()

  if (checkError) {
    console.error('Error checking existing packing session:', checkError)
    throw checkError
  }

  if (existing) {
    // If the same worker is re-claiming, return the existing session (for "Doorgaan" flow)
    if (existing.assigned_to === workerId) {
      return existing
    }
    throw new Error(`Picklist ${picklistId} is already claimed by ${existing.assigned_to_name}`)
  }

  // Create new session
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .insert({
      picklist_id: picklistId,
      picklistid: String(picklistId),
      assigned_to: workerId,
      assigned_to_name: workerName,
      status: 'claimed',
    })
    .select()
    .single()

  if (error) {
    console.error('Error claiming picklist:', error)
    throw error
  }

  return data
}

// ── Box CRUD ─────────────────────────────────────────────────────────────────

/**
 * Add a box to a packing session
 */
export async function addBox(sessionId: string, input: AddBoxInput): Promise<PackingSessionBox> {
  // Detect override: advice was given but a different packaging was chosen
  const wasOverride = input.suggested_packaging_id != null
    && input.picqer_packaging_id != null
    && input.picqer_packaging_id !== input.suggested_packaging_id

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .insert({
      session_id: sessionId,
      picqer_packaging_id: input.picqer_packaging_id,
      packaging_name: input.packaging_name,
      packaging_barcode: input.packaging_barcode,
      box_index: input.box_index,
      status: 'pending',
      packaging_advice_id: input.packaging_advice_id ?? null,
      suggested_packaging_id: input.suggested_packaging_id ?? null,
      suggested_packaging_name: input.suggested_packaging_name ?? null,
      was_override: wasOverride,
    })
    .select()
    .single()

  if (error) {
    console.error('Error adding box:', error)
    throw error
  }

  // Refresh session lock on activity
  await refreshSessionLock(sessionId)

  return data
}

/**
 * Update a box
 */
export async function updateBox(
  boxId: string,
  updates: Partial<Omit<PackingSessionBox, 'id' | 'session_id' | 'created_at' | 'updated_at'>>
): Promise<PackingSessionBox> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .update(updates)
    .eq('id', boxId)
    .select()
    .single()

  if (error) {
    console.error('Error updating box:', error)
    throw error
  }

  return data
}

/**
 * Remove a box
 */
export async function removeBox(boxId: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .delete()
    .eq('id', boxId)

  if (error) {
    console.error('Error removing box:', error)
    throw error
  }
}

/**
 * Get all boxes for a session
 */
export async function getBoxesBySession(sessionId: string): Promise<PackingSessionBox[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .select()
    .eq('session_id', sessionId)
    .order('box_index', { ascending: true })

  if (error) {
    console.error('Error fetching boxes:', error)
    throw error
  }

  return data || []
}

// ── Product assignment CRUD ──────────────────────────────────────────────────

/**
 * Assign a product to a box
 */
export async function assignProduct(input: AssignProductInput): Promise<PackingSessionProduct> {
  // Validate box belongs to session
  const { data: box, error: boxError } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .select('id')
    .eq('id', input.box_id)
    .eq('session_id', input.session_id)
    .maybeSingle()

  if (boxError) throw boxError
  if (!box) throw new Error('Box not found or does not belong to this session')

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_products')
    .insert({
      session_id: input.session_id,
      box_id: input.box_id,
      picqer_product_id: input.picqer_product_id,
      productcode: input.productcode,
      product_name: input.product_name,
      amount: input.amount,
      weight_per_unit: input.weight_per_unit,
    })
    .select()
    .single()

  if (error) {
    console.error('Error assigning product:', error)
    throw error
  }

  // Refresh session lock on activity
  await refreshSessionLock(input.session_id)

  return data
}

/**
 * Remove a product assignment
 */
export async function removeProduct(productId: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packing_session_products')
    .delete()
    .eq('id', productId)

  if (error) {
    console.error('Error removing product:', error)
    throw error
  }
}

/**
 * Update a product assignment (move to different box or change amount)
 */
export async function updateProductAssignment(
  productId: string,
  updates: { box_id?: string; amount?: number }
): Promise<PackingSessionProduct> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_products')
    .update(updates)
    .eq('id', productId)
    .select()
    .single()

  if (error) {
    console.error('Error updating product assignment:', error)
    throw error
  }

  return data
}

/**
 * Get all products for a session
 */
export async function getProductsBySession(sessionId: string): Promise<PackingSessionProduct[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_products')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching products:', error)
    throw error
  }

  return data || []
}

// ── Atomic shipping claim ────────────────────────────────────────────────────

/**
 * Atomically claim a box for shipping.
 * Only succeeds if the box is still in 'pending' or 'open' status.
 * Returns true if the claim succeeded, false if the box was already claimed/shipped.
 */
export async function claimBoxForShipping(boxId: string): Promise<boolean> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .update({ status: 'shipment_created' })
    .eq('id', boxId)
    .in('status', ['pending', 'open', 'closed'])
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('Error claiming box for shipping:', error)
    throw error
  }

  return !!data  // true if update succeeded (box was in valid state)
}

// ── Label operations ─────────────────────────────────────────────────────────

/**
 * Update a box with shipment data (label URL, tracking code, etc.)
 */
export async function updateBoxShipment(boxId: string, shipmentData: BoxShipmentData): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .update({
      shipment_id: shipmentData.shipment_id,
      tracking_code: shipmentData.tracking_code,
      label_url: shipmentData.label_url,
      status: shipmentData.status,
    })
    .eq('id', boxId)

  if (error) {
    console.error('Error updating box shipment:', error)
    throw error
  }
}

// ── Lock management ─────────────────────────────────────────────────────────

/**
 * Refresh the session lock on activity (extends lock by 30 minutes)
 */
export async function refreshSessionLock(sessionId: string): Promise<void> {
  const { error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .update({
      locked_at: new Date().toISOString(),
      lock_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    })
    .eq('id', sessionId)
    .in('status', ['claimed', 'packing', 'shipping'])

  if (error) {
    console.error('Error refreshing session lock:', error)
  }
}

// ── Session history ──────────────────────────────────────────────────────────

/**
 * Get paginated session history
 */
export async function getSessionHistory(
  options?: { limit?: number; offset?: number }
): Promise<{ sessions: PackingSession[]; total: number }> {
  const limit = options?.limit ?? 20
  const offset = options?.offset ?? 0

  // Get total count
  const { count, error: countError } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Error fetching session count:', countError)
    throw countError
  }

  // Get paginated data
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_sessions')
    .select()
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching session history:', error)
    throw error
  }

  return {
    sessions: data || [],
    total: count || 0,
  }
}
