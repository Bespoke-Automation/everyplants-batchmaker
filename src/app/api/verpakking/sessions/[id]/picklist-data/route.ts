import { NextRequest, NextResponse } from 'next/server'
import { getPackingSession } from '@/lib/supabase/packingSessions'
import {
  fetchPicklist,
  fetchOrder,
  getPicklistShippingMethods,
  getPicklistBatch,
} from '@/lib/picqer/client'
import { supabase } from '@/lib/supabase/client'
import { calculateAdvice } from '@/lib/engine/packagingEngine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/verpakking/sessions/[id]/picklist-data
 *
 * Aggregate endpoint that fetches ALL data needed to render VerpakkingsClient
 * in a single request. Server-side parallelization eliminates the client-side
 * waterfall of sequential API calls.
 *
 * Returns: picklist, order, shipping profile name, product attributes,
 *          engine advice, and comments — all in one response.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params

    // Step 1: Fetch session from Supabase (fast, ~100ms)
    const session = await getPackingSession(sessionId)
    const picklistId = session.picklist_id

    // Step 2: Fetch picklist from Picqer (~200-400ms)
    const picklist = await fetchPicklist(picklistId)

    // Step 3: Everything else in parallel (~max 500ms)
    // All of these are independent once we have the picklist
    const results = await Promise.allSettled([
      // Order data
      picklist.idorder
        ? fetchOrder(picklist.idorder)
        : Promise.resolve(null),

      // Shipping methods → find matching profile name
      picklist.idshippingprovider_profile
        ? getPicklistShippingMethods(picklistId)
        : Promise.resolve([]),

      // Product attributes from Supabase
      picklist.products?.length
        ? fetchProductAttributes(picklist.products.map(p => p.idproduct))
        : Promise.resolve({}),

      // Image enrichment from batch
      picklist.idpicklist_batch
        ? getPicklistBatch(picklist.idpicklist_batch).catch(() => null)
        : Promise.resolve(null),
    ])

    const [orderResult, shippingResult, attrsResult, batchResult] = results

    // Extract order
    const order = orderResult.status === 'fulfilled' ? orderResult.value : null

    // Extract shipping profile name
    let shippingProfileName: string | null = null
    if (shippingResult.status === 'fulfilled' && picklist.idshippingprovider_profile) {
      const methods = shippingResult.value as { idshippingprovider_profile: number; name: string }[]
      const match = methods.find(m => m.idshippingprovider_profile === picklist.idshippingprovider_profile)
      if (match) shippingProfileName = match.name
    }

    // Extract product attributes
    const productCustomFields = attrsResult.status === 'fulfilled' ? attrsResult.value : {}

    // Enrich products with images from batch
    if (batchResult.status === 'fulfilled' && batchResult.value) {
      const batch = batchResult.value
      const imageMap = new Map<number, string>()
      for (const bp of batch.products ?? []) {
        if (bp.image) imageMap.set(bp.idproduct, bp.image)
      }
      for (const product of picklist.products ?? []) {
        const image = imageMap.get(product.idproduct)
        if (image) product.image = image
      }
    }

    // Step 4: Engine advice (needs picklist products + order country code)
    // Run after order is available since countryCode improves advice quality
    let engineAdvice = null
    const errors: Record<string, string> = {}

    if (picklist.products?.length) {
      try {
        const products = picklist.products.map(pp => ({
          picqer_product_id: pp.idproduct,
          productcode: pp.productcode,
          quantity: pp.amount,
        }))

        engineAdvice = await calculateAdvice(
          picklist.idorder,
          picklist.idpicklist,
          products,
          picklist.idshippingprovider_profile ?? undefined,
          order?.deliverycountry?.toUpperCase()
        )
      } catch (err) {
        console.error('[picklist-data] Engine advice error:', err)
        errors.engine = err instanceof Error ? err.message : 'Engine calculation failed'
      }
    }

    // Collect any errors from settled promises
    if (orderResult.status === 'rejected') errors.order = String(orderResult.reason)
    if (shippingResult.status === 'rejected') errors.shipping = String(shippingResult.reason)
    if (attrsResult.status === 'rejected') errors.productAttributes = String(attrsResult.reason)

    return NextResponse.json({
      picklist,
      order,
      shippingProfileName,
      productCustomFields,
      engineAdvice,
      ...(Object.keys(errors).length > 0 && { _errors: errors }),
    })
  } catch (error) {
    console.error('[picklist-data] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch picklist data', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

/**
 * Fetch product attributes from Supabase, indexed by picqer_product_id
 */
async function fetchProductAttributes(productIds: number[]): Promise<Record<number, {
  productType: string | null
  potSize: number | null
  height: number | null
  isFragile: boolean
  isMixable: boolean
}>> {
  if (productIds.length === 0) return {}

  const { data, error } = await supabase
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, product_type, pot_size, height, is_fragile, is_mixable')
    .in('picqer_product_id', productIds)

  if (error) {
    console.error('[picklist-data] Error fetching product attributes:', error)
    return {}
  }

  const attributes: Record<number, {
    productType: string | null
    potSize: number | null
    height: number | null
    isFragile: boolean
    isMixable: boolean
  }> = {}

  for (const row of data || []) {
    attributes[row.picqer_product_id] = {
      productType: row.product_type ?? null,
      potSize: row.pot_size ?? null,
      height: row.height ?? null,
      isFragile: row.is_fragile ?? false,
      isMixable: row.is_mixable ?? true,
    }
  }

  return attributes
}
