import { NextResponse } from 'next/server'
import {
  getShipmentLabelsByBatch,
  uploadPdfToStorage,
  updateSingleOrderBatch,
} from '@/lib/supabase/shipmentLabels'
import { combineLabelsFromStorage } from '@/lib/pdf/combineFromStorage'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/single-orders/batch/[batchId]/recombine-pdf
 *
 * Re-combines all completed label PDFs into a single combined PDF.
 * Useful when a batch was retried and the combined PDF only contains
 * labels from the last run.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params

  if (!batchId) {
    return NextResponse.json({ error: 'Batch ID is required' }, { status: 400 })
  }

  console.log(`[${batchId}] Recombining PDFs...`)

  try {
    const labels = await getShipmentLabelsByBatch(batchId)
    const completedLabels = labels.filter(
      (l) => l.status === 'completed' && l.edited_label_path
    )

    if (completedLabels.length === 0) {
      return NextResponse.json({ error: 'No completed labels found' }, { status: 404 })
    }

    const combinedPdf = await combineLabelsFromStorage(completedLabels, batchId)
    if (!combinedPdf) {
      return NextResponse.json({ error: 'No PDFs could be downloaded' }, { status: 500 })
    }

    const combinedUrl = await uploadPdfToStorage(batchId, 'combined_labels.pdf', combinedPdf)

    await updateSingleOrderBatch(batchId, {
      combined_pdf_path: combinedUrl,
    })

    console.log(`[${batchId}] Combined PDF uploaded: ${combinedUrl}`)

    return NextResponse.json({
      success: true,
      batchId,
      labelsIncluded: completedLabels.length,
      combinedPdfUrl: combinedUrl,
    })
  } catch (error) {
    console.error(`[${batchId}] Error recombining PDFs:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
