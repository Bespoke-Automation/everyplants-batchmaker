import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import {
  getShipmentLabelsByBatch,
  uploadPdfToStorage,
  updateSingleOrderBatch,
} from '@/lib/supabase/shipmentLabels'
import { combinePdfs } from '@/lib/pdf/labelEditor'

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

    console.log(`[${batchId}] Found ${completedLabels.length} completed labels to combine`)

    const pdfBuffers: Buffer[] = []

    for (const label of completedLabels) {
      if (!label.edited_label_path) continue

      try {
        const url = new URL(label.edited_label_path)
        const pathParts = url.pathname.split('/storage/v1/object/public/shipment-labels/')
        const filePath = pathParts[1]

        if (!filePath) {
          console.error(`[${batchId}] Could not extract file path from: ${label.edited_label_path}`)
          continue
        }

        const { data, error } = await supabase.storage.from('shipment-labels').download(filePath)

        if (error) {
          console.error(`[${batchId}] Error downloading PDF ${filePath}:`, error)
          continue
        }

        const buffer = Buffer.from(await data.arrayBuffer())
        pdfBuffers.push(buffer)
      } catch (error) {
        console.error(`[${batchId}] Error processing PDF path:`, error)
      }
    }

    if (pdfBuffers.length === 0) {
      return NextResponse.json({ error: 'No PDFs could be downloaded' }, { status: 500 })
    }

    console.log(`[${batchId}] Combining ${pdfBuffers.length} PDFs...`)
    const combinedPdf = await combinePdfs(pdfBuffers)
    const combinedUrl = await uploadPdfToStorage(batchId, 'combined_labels.pdf', combinedPdf)

    await updateSingleOrderBatch(batchId, {
      combined_pdf_path: combinedUrl,
    })

    console.log(`[${batchId}] Combined PDF uploaded: ${combinedUrl}`)

    return NextResponse.json({
      success: true,
      batchId,
      labelsIncluded: pdfBuffers.length,
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
