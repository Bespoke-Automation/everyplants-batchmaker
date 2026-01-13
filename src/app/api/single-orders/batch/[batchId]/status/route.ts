import { NextResponse } from 'next/server'
import { getBatchProgress } from '@/lib/supabase/shipmentLabels'

export const dynamic = 'force-dynamic'

/**
 * GET /api/single-orders/batch/[batchId]/status
 *
 * Returns the current progress of a batch including:
 * - Overall batch status
 * - Count of shipments by status (queued, processing, completed, failed)
 * - Combined PDF URL when available
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await params

    if (!batchId) {
      return NextResponse.json(
        { error: 'Batch ID is required' },
        { status: 400 }
      )
    }

    const progress = await getBatchProgress(batchId)

    if (!progress) {
      return NextResponse.json(
        { error: 'Batch not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(progress)
  } catch (error) {
    console.error('Error fetching batch status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch batch status' },
      { status: 500 }
    )
  }
}
