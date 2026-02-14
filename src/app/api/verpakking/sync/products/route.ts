import { NextRequest, NextResponse } from 'next/server'
import { syncProductsBulk, classifyAllProducts, classifyProduct } from '@/lib/supabase/productAttributes'
import { supabase } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/verpakking/sync/products
 * Sync products from Picqer into local database and/or classify them
 *
 * Body: { mode: 'full' | 'incremental' | 'classify_only', updatedSince?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { mode, updatedSince } = body

    if (!mode || !['full', 'incremental', 'classify_only'].includes(mode)) {
      return NextResponse.json(
        { error: "Missing or invalid 'mode'. Must be 'full', 'incremental', or 'classify_only'." },
        { status: 400 }
      )
    }

    let syncStats = null
    let classifyStats = null

    if (mode === 'full') {
      // Full sync: fetch all products, then classify all unclassified
      syncStats = await syncProductsBulk()
      classifyStats = await classifyAllProducts()
    } else if (mode === 'incremental') {
      // Incremental sync: fetch only updated products, then classify only newly synced
      if (!updatedSince) {
        return NextResponse.json(
          { error: "Mode 'incremental' requires 'updatedSince' parameter (ISO 8601 date string)." },
          { status: 400 }
        )
      }

      syncStats = await syncProductsBulk(updatedSince)

      // Classify only newly synced products (those with classification_status = 'unclassified' and recent last_synced_at)
      const { data: newlySynced, error: fetchError } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('picqer_product_id')
        .eq('classification_status', 'unclassified')
        .gte('last_synced_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // synced within the last hour

      if (fetchError) {
        console.error('[product-sync] Error fetching newly synced products for classification:', fetchError)
      }

      if (newlySynced && newlySynced.length > 0) {
        classifyStats = { classified: 0, no_match: 0, missing_data: 0 }

        for (const product of newlySynced) {
          try {
            const result = await classifyProduct(product.picqer_product_id)

            if (result) {
              classifyStats.classified++
            } else {
              // Re-read to determine status
              const { data: updated } = await supabase
                .schema('batchmaker')
                .from('product_attributes')
                .select('classification_status')
                .eq('picqer_product_id', product.picqer_product_id)
                .single()

              if (updated?.classification_status === 'missing_data') {
                classifyStats.missing_data++
              } else {
                classifyStats.no_match++
              }
            }
          } catch (classifyError) {
            console.error(`[product-sync] Error classifying product ${product.picqer_product_id}:`, classifyError)
            classifyStats.no_match++
          }
        }
      }
    } else if (mode === 'classify_only') {
      // Only classify, no sync
      classifyStats = await classifyAllProducts()
    }

    return NextResponse.json({
      success: true,
      mode,
      sync: syncStats,
      classification: classifyStats,
    })
  } catch (error) {
    console.error('[verpakking] Error syncing products:', error)
    return NextResponse.json(
      { error: 'Failed to sync products', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
