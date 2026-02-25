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
  country: string | null
  created_at: string
  updated_at: string
}

export interface SingleOrderBatch {
  id: string
  batch_id: string
  name: string | null
  total_orders: number
  successful_shipments: number
  failed_shipments: number
  combined_pdf_path: string | null
  picqer_batch_id: number | null
  picqer_batch_ids: number[]
  picqer_batch_number: string | null
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
  country?: string
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
      country: input.country || 'NL',
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

export interface FailedLabel {
  order_reference: string | null
  error_message: string | null
}

export interface EnrichedBatch extends SingleOrderBatch {
  plants: string[]
  retailers: string[]
  failed_labels: FailedLabel[]
  has_stuck_labels: boolean
}

export interface BatchHistoryResult {
  batches: EnrichedBatch[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

/**
 * Get paginated batch history with enriched data (plants, retailers)
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

  const batches = data || []
  const totalCount = count || 0
  const totalPages = Math.ceil(totalCount / pageSize)

  // Enrich batches with plants and retailers from shipment_labels
  const batchIds = batches.map(b => b.batch_id)

  if (batchIds.length === 0) {
    return {
      batches: [],
      totalCount,
      page,
      pageSize,
      totalPages,
    }
  }

  // Fetch all labels for these batches in one query
  const { data: labels, error: labelsError } = await supabase
    .schema('batchmaker')
    .from('shipment_labels')
    .select('batch_id, plant_name, retailer, status, error_message, order_reference, created_at')
    .in('batch_id', batchIds)

  if (labelsError) {
    console.error('Error fetching shipment labels for history:', labelsError)
    // Continue without enrichment if labels fail
  }

  // Group labels by batch_id
  const TEN_MINUTES_MS = 10 * 60 * 1000
  const now = Date.now()
  const labelsByBatch = new Map<string, {
    plants: Set<string>
    retailers: Set<string>
    failed_labels: FailedLabel[]
    has_stuck_labels: boolean
  }>()

  for (const label of labels || []) {
    if (!labelsByBatch.has(label.batch_id)) {
      labelsByBatch.set(label.batch_id, {
        plants: new Set(),
        retailers: new Set(),
        failed_labels: [],
        has_stuck_labels: false,
      })
    }
    const entry = labelsByBatch.get(label.batch_id)!
    if (label.plant_name) entry.plants.add(label.plant_name)
    if (label.retailer) entry.retailers.add(label.retailer)

    if (label.status === 'error') {
      entry.failed_labels.push({
        order_reference: label.order_reference,
        error_message: label.error_message,
      })
    }

    if (
      (label.status === 'queued' || label.status === 'pending') &&
      label.created_at &&
      now - new Date(label.created_at).getTime() > TEN_MINUTES_MS
    ) {
      entry.has_stuck_labels = true
    }
  }

  // Enrich batches
  const enrichedBatches: EnrichedBatch[] = batches.map(batch => {
    const labelData = labelsByBatch.get(batch.batch_id)
    return {
      ...batch,
      plants: labelData ? Array.from(labelData.plants).sort() : [],
      retailers: labelData ? Array.from(labelData.retailers).sort() : [],
      failed_labels: labelData?.failed_labels ?? [],
      has_stuck_labels: labelData?.has_stuck_labels ?? false,
    }
  })

  return {
    batches: enrichedBatches,
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
