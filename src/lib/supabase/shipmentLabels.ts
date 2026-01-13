import { supabase } from './client'

export type ShipmentLabelStatus = 'queued' | 'pending' | 'shipment_created' | 'label_fetched' | 'label_edited' | 'completed' | 'error'
export type BatchStatus = 'batch_created' | 'processing_shipments' | 'processing' | 'completed' | 'partial' | 'failed' | 'trigger_failed'

export interface ShipmentLabel {
  id: string
  batch_id: string
  picklist_id: number
  shipment_id: number | null
  order_id: number | null
  order_reference: string | null
  retailer: string | null
  plant_name: string | null
  plant_product_code: string | null
  original_label_url: string | null
  edited_label_path: string | null
  tracking_code: string | null
  status: ShipmentLabelStatus
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface SingleOrderBatch {
  id: string
  batch_id: string
  total_orders: number
  successful_shipments: number
  failed_shipments: number
  combined_pdf_path: string | null
  picqer_batch_id: number | null
  picqer_batch_ids: number[]
  shipping_provider_id: number | null
  packaging_id: number | null
  status: BatchStatus
  webhook_triggered: boolean
  created_at: string
  updated_at: string
}

export interface CreateShipmentLabelInput {
  batch_id: string
  picklist_id: number
  order_id?: number
  order_reference?: string
  retailer?: string
  plant_name?: string
  plant_product_code?: string
}

/**
 * Create a new shipment label record
 */
export async function createShipmentLabel(input: CreateShipmentLabelInput): Promise<ShipmentLabel> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shipment_labels')
    .insert({
      batch_id: input.batch_id,
      picklist_id: input.picklist_id,
      order_id: input.order_id,
      order_reference: input.order_reference,
      retailer: input.retailer,
      plant_name: input.plant_name,
      plant_product_code: input.plant_product_code,
      status: 'queued',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating shipment label:', error)
    throw error
  }

  return data
}

/**
 * Update a shipment label record
 */
export async function updateShipmentLabel(
  id: string,
  updates: Partial<Omit<ShipmentLabel, 'id' | 'created_at' | 'updated_at'>>
): Promise<ShipmentLabel> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shipment_labels')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating shipment label:', error)
    throw error
  }

  return data
}

/**
 * Get all shipment labels for a batch
 */
export async function getShipmentLabelsByBatch(batchId: string): Promise<ShipmentLabel[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('shipment_labels')
    .select()
    .eq('batch_id', batchId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching shipment labels:', error)
    throw error
  }

  return data || []
}

/**
 * Create a new single order batch record
 */
export async function createSingleOrderBatch(batchId: string, totalOrders: number): Promise<SingleOrderBatch> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .insert({
      batch_id: batchId,
      total_orders: totalOrders,
      status: 'processing',
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating single order batch:', error)
    throw error
  }

  return data
}

/**
 * Update a single order batch record
 */
export async function updateSingleOrderBatch(
  batchId: string,
  updates: Partial<Omit<SingleOrderBatch, 'id' | 'batch_id' | 'created_at' | 'updated_at'>>
): Promise<SingleOrderBatch> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .update(updates)
    .eq('batch_id', batchId)
    .select()
    .single()

  if (error) {
    console.error('Error updating single order batch:', error)
    throw error
  }

  return data
}

/**
 * Get a single order batch by ID
 */
export async function getSingleOrderBatch(batchId: string): Promise<SingleOrderBatch | null> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .select()
    .eq('batch_id', batchId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned
      return null
    }
    console.error('Error fetching single order batch:', error)
    throw error
  }

  return data
}

/**
 * Upload a PDF to Supabase Storage
 */
export async function uploadPdfToStorage(
  batchId: string,
  fileName: string,
  pdfBuffer: Buffer
): Promise<string> {
  const filePath = `${batchId}/${fileName}`

  const { error } = await supabase.storage
    .from('shipment-labels')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) {
    console.error('Error uploading PDF to storage:', error)
    throw error
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('shipment-labels')
    .getPublicUrl(filePath)

  return urlData.publicUrl
}

/**
 * Get recent single order batches
 */
export async function getRecentBatches(limit: number = 10): Promise<SingleOrderBatch[]> {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .select()
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error fetching recent batches:', error)
    throw error
  }

  return data || []
}

export interface BatchHistoryResult {
  batches: SingleOrderBatch[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Get paginated batch history
 */
export async function getBatchHistory(
  page: number = 1,
  pageSize: number = 20
): Promise<BatchHistoryResult> {
  const offset = (page - 1) * pageSize

  // Get total count
  const { count, error: countError } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Error fetching batch count:', countError)
    throw countError
  }

  // Get paginated data
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .select()
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (error) {
    console.error('Error fetching batch history:', error)
    throw error
  }

  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / pageSize)

  return {
    batches: data || [],
    totalCount,
    page,
    pageSize,
    totalPages,
  }
}

export interface BatchProgress {
  batchId: string
  status: BatchStatus
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  combinedPdfUrl: string | null
  picqerBatchIds: number[]
}

/**
 * Get batch progress including shipment label counts by status
 */
export async function getBatchProgress(batchId: string): Promise<BatchProgress | null> {
  // Get batch record
  const { data: batch, error: batchError } = await supabase
    .schema('batchmaker')
    .from('single_order_batches')
    .select()
    .eq('batch_id', batchId)
    .single()

  if (batchError) {
    if (batchError.code === 'PGRST116') {
      return null
    }
    console.error('Error fetching batch:', batchError)
    throw batchError
  }

  // Get shipment label counts by status
  const { data: labels, error: labelsError } = await supabase
    .schema('batchmaker')
    .from('shipment_labels')
    .select('status')
    .eq('batch_id', batchId)

  if (labelsError) {
    console.error('Error fetching shipment labels:', labelsError)
    throw labelsError
  }

  const statusCounts = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  }

  for (const label of labels || []) {
    if (label.status === 'queued') {
      statusCounts.queued++
    } else if (label.status === 'error') {
      statusCounts.failed++
    } else if (label.status === 'completed') {
      statusCounts.completed++
    } else {
      // pending, shipment_created, label_fetched, label_edited are all "processing"
      statusCounts.processing++
    }
  }

  return {
    batchId: batch.batch_id,
    status: batch.status,
    total: batch.total_orders,
    queued: statusCounts.queued,
    processing: statusCounts.processing,
    completed: statusCounts.completed,
    failed: statusCounts.failed,
    combinedPdfUrl: batch.combined_pdf_path,
    picqerBatchIds: batch.picqer_batch_ids || [],
  }
}
