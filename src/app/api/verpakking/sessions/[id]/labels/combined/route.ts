import { NextRequest, NextResponse } from 'next/server'
import { getBoxesBySession } from '@/lib/supabase/packingSessions'
import { supabase } from '@/lib/supabase/client'
import { combinePdfs } from '@/lib/pdf/labelEditor'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions/[id]/labels/combined
 * Downloads all label PDFs and combines them into a single PDF
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params

    const boxes = await getBoxesBySession(sessionId)
    const boxesWithLabels = boxes.filter(box => box.label_url)

    if (boxesWithLabels.length === 0) {
      return NextResponse.json(
        { error: 'Geen labels beschikbaar' },
        { status: 404 }
      )
    }

    // Download all label PDFs in parallel
    const storageMarker = '/storage/v1/object/public/shipment-labels/'
    const downloads = await Promise.allSettled(
      boxesWithLabels.map(async (box) => {
        const labelUrl = box.label_url!

        // Extract storage path from public URL
        const markerIdx = labelUrl.indexOf(storageMarker)

        if (markerIdx !== -1) {
          // Download from Supabase Storage
          const filePath = decodeURIComponent(labelUrl.slice(markerIdx + storageMarker.length))
          const { data, error } = await supabase.storage.from('shipment-labels').download(filePath)
          if (error || !data) {
            throw new Error(`Failed to download label for box ${box.box_index}: ${error?.message}`)
          }
          return Buffer.from(await data.arrayBuffer())
        } else {
          // External URL — fetch directly
          const res = await fetch(labelUrl)
          if (!res.ok) throw new Error(`Failed to fetch label: ${res.status}`)
          return Buffer.from(await res.arrayBuffer())
        }
      })
    )

    const pdfBuffers: Buffer[] = []
    for (const result of downloads) {
      if (result.status === 'fulfilled') {
        pdfBuffers.push(result.value)
      }
    }

    const failedCount = boxesWithLabels.length - pdfBuffers.length

    if (pdfBuffers.length === 0) {
      return NextResponse.json(
        { error: 'Geen labels konden worden gedownload' },
        { status: 500 }
      )
    }

    // Combine all PDFs
    const combinedPdf = await combinePdfs(pdfBuffers)

    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="labels-${sessionId.slice(0, 8)}.pdf"`,
      'Content-Length': String(combinedPdf.length),
    }
    if (failedCount > 0) {
      headers['X-Labels-Missing'] = String(failedCount)
      headers['X-Labels-Warning'] = `${failedCount} van ${boxesWithLabels.length} labels konden niet worden gedownload`
    }

    return new NextResponse(new Uint8Array(combinedPdf), { headers })
  } catch (error) {
    console.error('[verpakking] Error combining labels:', error)
    return NextResponse.json(
      { error: 'Failed to combine labels', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
