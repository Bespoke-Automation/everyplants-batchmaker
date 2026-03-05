import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getFloridayProducts } from '@/lib/floriday/stock-service'
import { getNextNWeeks, weekKey } from '@/lib/floriday/utils'

export const dynamic = 'force-dynamic'

const SYNC_WEEKS = 6

/**
 * GET /api/floriday/catalog-supply/products
 *
 * Retourneert alle kunstplant-producten met hun Floriday mapping status,
 * alternatieve SKU en VBN code.
 */
export async function GET() {
  try {
    const env = getFloridayEnv()

    // Stap 1: producten ophalen uit Picqer
    const products = await getFloridayProducts()
    const productIds = products.map(p => p.idproduct)

    // Stap 2: enrichment queries gefilterd op alleen deze product IDs
    const [mappingsResult, productIndexResult, tradeItemsResult] = await Promise.all([
      supabase
        .schema('floriday')
        .from('product_mapping')
        .select('picqer_product_id, floriday_trade_item_id, floriday_supplier_article_code, last_stock_sync_at')
        .eq('environment', env)
        .eq('is_active', true)
        .in('picqer_product_id', productIds),
      supabase
        .schema('floriday')
        .from('picqer_product_index')
        .select('picqer_product_id, alt_sku')
        .in('picqer_product_id', productIds),
      supabase
        .schema('floriday')
        .from('trade_items')
        .select('trade_item_id, vbn_product_code')
        .eq('environment', env),
    ])

    // Build lookup maps
    const mappingMap = new Map(
      (mappingsResult.data ?? []).map(m => [
        m.picqer_product_id,
        {
          tradeItemId: m.floriday_trade_item_id,
          supplierArticleCode: m.floriday_supplier_article_code,
          lastSyncedAt: m.last_stock_sync_at,
        },
      ])
    )

    const altSkuMap = new Map(
      (productIndexResult.data ?? []).map(p => [p.picqer_product_id, p.alt_sku as string | null])
    )

    const vbnMap = new Map(
      (tradeItemsResult.data ?? []).map(t => [t.trade_item_id, t.vbn_product_code as number | null])
    )

    // Week headers voor UI
    const weeks = getNextNWeeks(SYNC_WEEKS)
    const weekHeaders = weeks.map(w => weekKey(w.year, w.week))

    // Combineer product data + mapping status + alt sku + vbn
    const result = products.map(p => {
      const mapping = mappingMap.get(p.idproduct)
      const altSku = altSkuMap.get(p.idproduct) ?? null
      const vbnCode = mapping?.tradeItemId ? (vbnMap.get(mapping.tradeItemId) ?? null) : null

      return {
        picqerProductId: p.idproduct,
        productcode: p.productcode,
        name: p.name,
        altSku,
        tradeItemId: mapping?.tradeItemId ?? null,
        vbnCode,
        lastSyncedAt: mapping?.lastSyncedAt ?? null,
      }
    })

    // Sorteer: gemapte producten eerst, dan op naam
    result.sort((a, b) => {
      if (a.tradeItemId && !b.tradeItemId) return -1
      if (!a.tradeItemId && b.tradeItemId) return 1
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({
      success: true,
      products: result,
      weekHeaders,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    console.error('Catalog supply products error:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
