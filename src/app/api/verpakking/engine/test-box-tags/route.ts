export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { fetchOrder, getTags, addOrderTag } from '@/lib/picqer/client'
import { previewAdvice } from '@/lib/engine/packagingEngine'
import { supabase } from '@/lib/supabase/client'
import type { OrderProduct } from '@/lib/engine/packagingEngine'

/**
 * POST /api/verpakking/engine/test-box-tags
 * Test the auto box tag flow for an order.
 * Body: { orderId: number, dryRun?: boolean }
 *
 * dryRun=true (default): only show what would be written
 * dryRun=false: actually write tags to Picqer
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { orderId, dryRun = true } = body

    if (!orderId || typeof orderId !== 'number') {
      return NextResponse.json(
        { error: 'orderId is required and must be a number' },
        { status: 400 }
      )
    }

    // 1. Fetch order
    const order = await fetchOrder(orderId)
    const countryCode = order.deliverycountry?.toUpperCase() || 'NL'

    // 2. Map products
    const products: OrderProduct[] = order.products.map((p: { idproduct: number; productcode: string; amount: number }) => ({
      picqer_product_id: p.idproduct,
      productcode: p.productcode,
      quantity: p.amount,
    }))

    // 3. Run engine preview
    const advice = await previewAdvice(products, countryCode)

    // 4. Map packaging names → Picqer tags via packagings table
    const { data: packagings } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .select('name, picqer_tag_name, picqer_tag_id')
      .eq('active', true)

    const packagingTagMap = new Map<string, { picqer_tag_name: string | null; picqer_tag_id: number | null }>()
    for (const p of packagings ?? []) {
      packagingTagMap.set(p.name.trim(), {
        picqer_tag_name: p.picqer_tag_name?.trim() ?? null,
        picqer_tag_id: p.picqer_tag_id ?? null,
      })
    }

    // 5. Resolve unique packaging names → tag info
    const uniquePackagingNames = [...new Set(advice.advice_boxes.map(box => box.packaging_name))]

    // Also fetch Picqer tags for fallback lookup by name
    const allPicqerTags = await getTags()
    const picqerTagByTitle = new Map(allPicqerTags.map(t => [t.title.trim(), t.idtag]))

    const tagResolution = uniquePackagingNames.map(packagingName => {
      const tagInfo = packagingTagMap.get(packagingName.trim())

      let resolvedTagId: number | null = tagInfo?.picqer_tag_id ?? null
      let resolvedVia = tagInfo?.picqer_tag_id ? 'picqer_tag_id' : null

      if (!resolvedTagId && tagInfo?.picqer_tag_name) {
        resolvedTagId = picqerTagByTitle.get(tagInfo.picqer_tag_name) ?? null
        resolvedVia = resolvedTagId ? 'picqer_tag_name_lookup' : null
      }

      return {
        packaging_name: packagingName,
        picqer_tag_name: tagInfo?.picqer_tag_name ?? null,
        picqer_tag_id_from_db: tagInfo?.picqer_tag_id ?? null,
        resolved_tag_id: resolvedTagId,
        resolved_via: resolvedVia,
        would_write: resolvedTagId !== null,
      }
    })

    // 6. If not dry run, actually write tags
    const writeResults: { tag: string; tagId: number; success: boolean; error?: string }[] = []

    if (!dryRun) {
      for (const tag of tagResolution) {
        if (!tag.resolved_tag_id) continue
        try {
          await addOrderTag(orderId, tag.resolved_tag_id)
          writeResults.push({ tag: tag.picqer_tag_name ?? tag.packaging_name, tagId: tag.resolved_tag_id, success: true })
        } catch (err) {
          writeResults.push({
            tag: tag.picqer_tag_name ?? tag.packaging_name,
            tagId: tag.resolved_tag_id,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
          })
        }
      }
    }

    return NextResponse.json({
      orderId,
      dryRun,
      order: {
        orderid: order.orderid,
        status: order.status,
        deliveryname: order.deliveryname,
        deliverycountry: countryCode,
        existing_tags: Object.values(order.tags).map((t: { idtag: number; title: string }) => ({ idtag: t.idtag, title: t.title })),
        product_count: products.length,
      },
      engine: {
        confidence: advice.confidence,
        advice_boxes: advice.advice_boxes.map(b => ({
          packaging_name: b.packaging_name,
          products: b.products,
        })),
        unclassified: advice.unclassified_products,
        shipping_units: advice.shipping_units_detected,
      },
      tag_resolution: tagResolution,
      ...(dryRun ? {} : { write_results: writeResults }),
    })
  } catch (error) {
    console.error('[test-box-tags] Error:', error)
    return NextResponse.json(
      { error: 'Failed to test box tags', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
