import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import {
  getSingleOrderBatch,
  updateSingleOrderBatch,
} from '@/lib/supabase/shipmentLabels'
import { inngest } from '@/inngest/client'

export const dynamic = 'force-dynamic'

const TEN_MINUTES_MS = 10 * 60 * 1000

/**
 * POST /api/single-orders/batch/[batchId]/retry
 *
 * Resets failed and stuck labels to 'queued' and triggers reprocessing via Inngest.
 * - Labels with status 'error' are always retried
 * - Labels with status 'queued' or 'pending' older than 10 minutes are considered stuck
 * - Uses Inngest for durable step-based processing (no Vercel timeout issues)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params

  if (!batchId) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  try {
    const batch = await getSingleOrderBatch(batchId)
    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 })
    }

    // Find all error labels
    const { data: errorLabels, error: errorLabelsErr } = await supabase
      .schema('batchmaker')
      .from('shipment_labels')
      .select('id')
      .eq('batch_id', batchId)
      .eq('status', 'error')

    if (errorLabelsErr) throw errorLabelsErr

    // Find stuck labels (queued/pending older than 10 minutes)
    const stuckCutoff = new Date(Date.now() - TEN_MINUTES_MS).toISOString()

    const { data: stuckLabels, error: stuckLabelsErr } = await supabase
      .schema('batchmaker')
      .from('shipment_labels')
      .select('id')
      .eq('batch_id', batchId)
      .in('status', ['queued', 'pending'])
      .lt('created_at', stuckCutoff)

    if (stuckLabelsErr) throw stuckLabelsErr

    const labelIds = [
      ...(errorLabels || []).map(l => l.id),
      ...(stuckLabels || []).map(l => l.id),
    ]

    if (labelIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Geen labels om opnieuw te proberen',
        retryCount: 0,
      })
    }

    // Reset labels to queued and clear error messages
    const { error: resetError } = await supabase
      .schema('batchmaker')
      .from('shipment_labels')
      .update({ status: 'queued', error_message: null, updated_at: new Date().toISOString() })
      .in('id', labelIds)

    if (resetError) throw resetError

    // Update batch status to processing
    await updateSingleOrderBatch(batchId, {
      status: 'processing_shipments',
    })

    // Trigger Inngest for durable step-based processing
    await inngest.send({
      name: 'batch/process.requested',
      data: { batchId },
    })

    console.log(`[${batchId}] Retry triggered: ${labelIds.length} labels reset, Inngest event sent`)

    return NextResponse.json({
      success: true,
      retryCount: labelIds.length,
      message: `${labelIds.length} labels worden opnieuw verwerkt`,
    })
  } catch (error) {
    console.error(`[${batchId}] Error retrying labels:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
