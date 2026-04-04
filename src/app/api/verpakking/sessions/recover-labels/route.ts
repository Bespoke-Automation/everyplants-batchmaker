import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getShipmentLabel } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * Upload a PDF label to Supabase Storage
 */
async function uploadLabelToStorage(
  sessionId: string,
  boxId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const filePath = `verpakking/${sessionId}/${boxId}.pdf`

  const { error } = await supabase.storage
    .from('shipment-labels')
    .upload(filePath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) throw error

  const { data: urlData } = supabase.storage
    .from('shipment-labels')
    .getPublicUrl(filePath)

  return urlData.publicUrl
}

/**
 * POST /api/verpakking/sessions/recover-labels
 * Finds boxes stuck in 'shipment_created' and retries label download + storage.
 * Safe to call multiple times (idempotent).
 */
export async function POST() {
  try {
    // Find boxes where shipment was created but label not fully processed
    const { data: stuckBoxes, error } = await supabase
      .schema('batchmaker')
      .from('packing_session_boxes')
      .select('id, session_id, shipment_id, label_url')
      .eq('status', 'shipment_created')
      .not('shipment_id', 'is', null)
      .lt('shipped_at', new Date(Date.now() - 5 * 60 * 1000).toISOString())

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!stuckBoxes || stuckBoxes.length === 0) {
      return NextResponse.json({ recovered: 0, message: 'Geen dozen om te herstellen' })
    }

    const results: { boxId: string; success: boolean; error?: string }[] = []

    for (const box of stuckBoxes) {
      try {
        // Try to download label from Picqer URL or API
        const labelResult = await getShipmentLabel(box.shipment_id!, box.label_url || undefined)

        if (!labelResult.success || !labelResult.labelData) {
          results.push({ boxId: box.id, success: false, error: labelResult.error || 'Label download failed' })
          continue
        }

        // Upload to storage
        const storageUrl = await uploadLabelToStorage(box.session_id, box.id, labelResult.labelData)

        // Update box to label_fetched
        await supabase
          .schema('batchmaker')
          .from('packing_session_boxes')
          .update({ label_url: storageUrl, status: 'label_fetched' })
          .eq('id', box.id)

        results.push({ boxId: box.id, success: true })
      } catch (err) {
        results.push({ boxId: box.id, success: false, error: err instanceof Error ? err.message : 'Unknown error' })
      }
    }

    const recovered = results.filter(r => r.success).length
    return NextResponse.json({
      recovered,
      total: stuckBoxes.length,
      results,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Recovery failed' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/verpakking/sessions/recover-labels
 * Check how many boxes are stuck in 'shipment_created'
 */
export async function GET() {
  const { data, error } = await supabase
    .schema('batchmaker')
    .from('packing_session_boxes')
    .select('id, session_id, shipment_id, shipped_at, label_url')
    .eq('status', 'shipment_created')
    .not('shipment_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    stuckBoxes: data?.length || 0,
    boxes: data || [],
  })
}
