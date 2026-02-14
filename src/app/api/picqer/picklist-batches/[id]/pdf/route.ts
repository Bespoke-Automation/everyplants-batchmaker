import { NextRequest, NextResponse } from 'next/server'
import { getPicklistBatchPdf } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/picqer/picklist-batches/[id]/pdf
 * Fetch batch PDF (packing slips) from Picqer
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const batchId = parseInt(id, 10)

    if (isNaN(batchId)) {
      return NextResponse.json({ error: 'Invalid batch ID' }, { status: 400 })
    }

    const searchParams = request.nextUrl.searchParams
    const includePicklists = searchParams.get('includePicklists') === 'true'
    const includePackinglists = searchParams.get('includePackinglists') === 'true'

    const result = await getPicklistBatchPdf(batchId, { includePicklists, includePackinglists })

    if (!result.success || !result.data) {
      return NextResponse.json(
        { error: result.error || 'Failed to fetch PDF' },
        { status: 500 }
      )
    }

    return new NextResponse(new Uint8Array(result.data), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="batch-${batchId}.pdf"`,
      },
    })
  } catch (error) {
    console.error('[picqer] Error fetching batch PDF:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch PDF', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
