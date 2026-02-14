import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Totals per classification_status
    const { data: statusCounts, error: countError } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('classification_status')

    if (countError) throw countError

    const counts = { classified: 0, unclassified: 0, error: 0, pending: 0 }
    for (const row of statusCounts || []) {
      const status = row.classification_status as keyof typeof counts
      if (status in counts) counts[status]++
    }
    const total = (statusCounts || []).length

    // Unclassified products (max 100)
    const { data: unclassified, error: unclError } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('productcode, product_name, pot_size, height, product_type')
      .eq('classification_status', 'unclassified')
      .order('productcode')
      .limit(100)

    if (unclError) throw unclError

    // Last sync
    const { data: lastSync } = await supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('last_synced_at')
      .not('last_synced_at', 'is', null)
      .order('last_synced_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    return NextResponse.json({
      total,
      classified: counts.classified,
      unclassified: counts.unclassified,
      error: counts.error,
      pending: counts.pending,
      lastSyncedAt: lastSync?.last_synced_at ?? null,
      unclassifiedProducts: unclassified || [],
    })
  } catch (error) {
    console.error('[products/status] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch product status' },
      { status: 500 }
    )
  }
}
