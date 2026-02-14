import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')
    const confidence = searchParams.get('confidence')
    const outcome = searchParams.get('outcome')

    // Build query
    let query = supabase
      .schema('batchmaker')
      .from('packaging_advice')
      .select('id, order_id, picklist_id, status, confidence, advice_boxes, unclassified_products, tags_written, calculated_at, outcome, deviation_type, actual_boxes, resolved_at, shipping_unit_fingerprint, weight_exceeded', { count: 'exact' })
      .neq('status', 'invalidated')
      .order('calculated_at', { ascending: false })

    if (confidence) {
      query = query.eq('confidence', confidence)
    }
    if (outcome === 'pending') {
      query = query.is('outcome', null)
    } else if (outcome) {
      query = query.eq('outcome', outcome)
    }

    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) throw error

    return NextResponse.json({
      advices: data || [],
      total: count || 0,
    })
  } catch (error) {
    console.error('[engine/log] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch engine log' },
      { status: 500 }
    )
  }
}
