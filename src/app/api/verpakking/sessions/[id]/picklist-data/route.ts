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
    const t0 = Date.now()

    // Step 1: Fetch session from Supabase
    const session = await getPackingSession(sessionId)
    const picklistId = session.picklist_id
    const tSession = Date.now() - t0

    // Step 2: Fetch picklist from Picqer
    const t1 = Date.now()
    const picklist = await fetchPicklist(picklistId)
    const tPicklist = Date.now() - t1

    // Step 3: Everything in parallel — including engine advice
    // Engine doesn't need order.deliverycountry (it's optional), so we can
    // run it simultaneously with order/shipping/attrs/images.
    const engineProducts = picklist.products?.length
      ? picklist.products.map(pp => ({
          picqer_product_id: pp.idproduct,
          productcode: pp.productcode,
          quantity: pp.amount,
        }))
      : null

    const t2 = Date.now()
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

      // Engine advice (runs in parallel — countryCode not yet available but optional)
      engineProducts
        ? calculateAdvice(
            picklist.idorder,
            picklist.idpicklist,
            engineProducts,
            picklist.idshippingprovider_profile ?? undefined,
            undefined // countryCode not available yet, engine handles this gracefully
          ).catch((err) => {
            console.error('[picklist-data] Engine advice error:', err)
            return null
          })
        : Promise.resolve(null),
    ])
    const tParallel = Date.now() - t2
    const tTotal = Date.now() - t0

    const [orderResult, shippingResult, attrsResult, batchResult, engineResult] = results

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

    // Extract engine advice
    const engineAdvice = engineResult.status === 'fulfilled' ? engineResult.value : null
    const errors: Record<string, string> = {}
    if (engineResult.status === 'rejected') errors.engine = String(engineResult.reason)

    console.log(`[picklist-data] Timing: session=${tSession}ms picklist=${tPicklist}ms parallel+engine=${tParallel}ms total=${tTotal}ms`)

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
