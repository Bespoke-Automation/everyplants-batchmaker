import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const VALID_STATUSES = ['all', 'classified', 'unclassified', 'missing_data', 'no_match', 'error'] as const
type StatusFilter = (typeof VALID_STATUSES)[number]

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const status = (params.get('status') || 'all') as StatusFilter
    const search = params.get('search')?.trim() || ''
    const productType = params.get('product_type') || ''
    const page = Math.max(1, parseInt(params.get('page') || '1', 10))
    const perPage = Math.min(100, Math.max(1, parseInt(params.get('per_page') || '50', 10)))

    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 })
    }

    // KPI counts (always returned, parallel queries)
    const [totalRes, classifiedRes, unclassifiedRes, missingDataRes, noMatchRes, errorRes, lastSync] = await Promise.all([
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }),
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }).eq('classification_status', 'classified'),
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }).eq('classification_status', 'unclassified'),
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }).eq('classification_status', 'missing_data'),
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }).eq('classification_status', 'no_match'),
      supabase.schema('batchmaker').from('product_attributes').select('id', { count: 'exact', head: true }).eq('classification_status', 'error'),
      supabase.schema('batchmaker').from('product_attributes').select('last_synced_at').not('last_synced_at', 'is', null).order('last_synced_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    // Fetch distinct product types (paginate to overcome 1000-row limit)
    const typeSet = new Set<string>()
    let typeOffset = 0
    while (true) {
      const { data } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('product_type')
        .not('product_type', 'is', null)
        .range(typeOffset, typeOffset + 999)
      if (!data || data.length === 0) break
      for (const r of data) if (r.product_type) typeSet.add(r.product_type)
      if (data.length < 1000) break
      typeOffset += 1000
    }
    const productTypes = [...typeSet].sort()

    // Build filtered query for product list
    let query = supabase
      .schema('batchmaker')
      .from('product_attributes')
      .select('id, productcode, product_name, pot_size, height, product_type, classification_status, shipping_unit_id, default_packaging_id, image_url', { count: 'exact' })

    // Status filter
    if (status !== 'all') {
      query = query.eq('classification_status', status)
    }

    // Product type filter
    if (productType) {
      query = query.eq('product_type', productType)
    }

    // Search (ILIKE on productcode and product_name)
    if (search) {
      query = query.or(`productcode.ilike.%${search}%,product_name.ilike.%${search}%`)
    }

    // Pagination
    const from = (page - 1) * perPage
    const to = from + perPage - 1
    query = query.order('productcode').range(from, to)

    const { data: products, count: filteredCount, error: queryError } = await query

    if (queryError) throw queryError

    return NextResponse.json({
      counts: {
        total: totalRes.count ?? 0,
        classified: classifiedRes.count ?? 0,
        unclassified: unclassifiedRes.count ?? 0,
        missing_data: missingDataRes.count ?? 0,
        no_match: noMatchRes.count ?? 0,
        error: errorRes.count ?? 0,
      },
      lastSyncedAt: lastSync?.data?.last_synced_at ?? null,
      productTypes,
      products: products || [],
      filteredCount: filteredCount ?? 0,
      page,
      perPage,
      totalPages: Math.ceil((filteredCount ?? 0) / perPage),
    })
  } catch (error) {
    console.error('[products/status] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch product status' },
      { status: 500 }
    )
  }
}
