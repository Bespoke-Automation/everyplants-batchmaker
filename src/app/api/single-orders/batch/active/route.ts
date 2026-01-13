import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

interface ActiveBatchProgress {
  batchId: string
  status: string
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  combinedPdfUrl: string | null
  createdAt: string
}

/**
 * GET /api/single-orders/batch/active
 *
 * Returns all batches with status 'processing_shipments' or 'processing'
 * including progress (queued, processing, completed, failed counts) for each
 *
 * Query params:
 * - includeBatchId: Also include this specific batch (bypasses read replica lag)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const includeBatchId = searchParams.get('includeBatchId')

    // If includeBatchId is specified, query the batch record directly for progress
    // The process endpoint updates successful_shipments/failed_shipments after each shipment
    // This is more reliable than counting labels (which may suffer from read replica lag)
    let specificBatchProgress: ActiveBatchProgress | null = null

    if (includeBatchId) {
      const { data: batchRecord, error: batchRecordError } = await supabase
        .schema('batchmaker')
        .from('single_order_batches')
        .select('*')
        .eq('batch_id', includeBatchId)
        .single()

      if (!batchRecordError && batchRecord) {
        const completed = batchRecord.successful_shipments || 0
        const failed = batchRecord.failed_shipments || 0
        const total = batchRecord.total_orders
        const remaining = total - completed - failed

        console.log(`[active] Batch ${includeBatchId.slice(-8)}: completed=${completed}, failed=${failed}, total=${total}, status=${batchRecord.status}`)

        specificBatchProgress = {
          batchId: includeBatchId,
          status: batchRecord.status,
          total,
          queued: 0,  // Not tracked separately - use 'processing' for remaining
          processing: remaining,
          completed,
          failed,
          combinedPdfUrl: batchRecord.combined_pdf_path || null,
          createdAt: batchRecord.created_at,
        }
      }
    }

    // Get all batches that are currently processing
    const { data: batches, error: batchError } = await supabase
      .schema('batchmaker')
      .from('single_order_batches')
      .select()
      .in('status', ['processing_shipments', 'processing', 'batch_created', 'trigger_failed'])
      .order('created_at', { ascending: false })

    if (batchError) {
      console.error('Error fetching active batches:', batchError)
      return NextResponse.json(
        { error: 'Failed to fetch active batches' },
        { status: 500 }
      )
    }

    const allBatches = batches || []

    // If we only have the specific batch and no other active batches, return just that
    if (allBatches.length === 0) {
      if (specificBatchProgress) {
        return NextResponse.json({ batches: [specificBatchProgress] })
      }
      return NextResponse.json({ batches: [] })
    }

    // Get batch IDs (exclude the specific batch if we already have fresh data for it)
    const batchIds = allBatches
      .filter(b => b.batch_id !== includeBatchId)
      .map(b => b.batch_id)

    // Calculate progress for each batch
    const progressByBatch: Record<string, ActiveBatchProgress> = {}

    // Add fresh data for specific batch first
    if (specificBatchProgress) {
      progressByBatch[specificBatchProgress.batchId] = specificBatchProgress
    }

    // Initialize progress for other batches
    for (const batch of allBatches) {
      if (batch.batch_id === includeBatchId) continue // Skip - we have fresh data
      progressByBatch[batch.batch_id] = {
        batchId: batch.batch_id,
        status: batch.status,
        total: batch.total_orders,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        combinedPdfUrl: batch.combined_pdf_path,
        createdAt: batch.created_at,
      }
    }

    // Get shipment label counts for other active batches (not the specific one)
    if (batchIds.length > 0) {
      const { data: labels, error: labelsError } = await supabase
        .schema('batchmaker')
        .from('shipment_labels')
        .select('batch_id, status')
        .in('batch_id', batchIds)

      if (labelsError) {
        console.error('Error fetching shipment labels:', labelsError)
        return NextResponse.json(
          { error: 'Failed to fetch shipment labels' },
          { status: 500 }
        )
      }

      // Count labels by status for each batch
      for (const label of labels || []) {
        const progress = progressByBatch[label.batch_id]
        if (!progress) continue

        if (label.status === 'queued') {
          progress.queued++
        } else if (label.status === 'error') {
          progress.failed++
        } else if (label.status === 'completed') {
          progress.completed++
        } else {
          // pending, shipment_created, label_fetched, label_edited are all "processing"
          progress.processing++
        }
      }
    }

    return NextResponse.json({
      batches: Object.values(progressByBatch),
    })

  } catch (error) {
    console.error('Error in active batches endpoint:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
