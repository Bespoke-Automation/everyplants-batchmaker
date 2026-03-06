import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getFloridayProducts } from '@/lib/floriday/stock-service'
import { getWeeklyBaseSupplies } from '@/lib/floriday/client'
import { getNextNWeeks, weekKey } from '@/lib/floriday/utils'

export const dynamic = 'force-dynamic'

const SYNC_WEEKS = 6

/**
 * GET /api/floriday/catalog-supply/products
 *
 * Retourneert alle kunstplant-producten met hun Floriday mapping status,
 * alternatieve SKU, VBN code en actuele weekvoorraad uit Floriday.
 */
export async function GET() {
  try {
    const env = getFloridayEnv()

    // Stap 1: producten ophalen uit Picqer
    const products = await getFloridayProducts()
    const productIds = products.map(p => p.idproduct)

    // Stap 2: enrichment via view (1 query i.p.v. 3)
    const { data: mappings } = await supabase
      .schema('floriday')
      .from('enriched_product_mapping')
      .select('picqer_product_id, floriday_trade_item_id, floriday_trade_item_name, floriday_supplier_article_code, match_method, last_stock_sync_at, alt_sku, vbn_product_code')
      .eq('environment', env)
      .eq('is_active', true)
      .in('picqer_product_id', productIds)

    const mappingMap = new Map(
      (mappings ?? []).map(m => [m.picqer_product_id, m])
    )

    // Week headers voor UI
    const weeks = getNextNWeeks(SYNC_WEEKS)
    const weekHeaders = weeks.map(w => weekKey(w.year, w.week))

    // Stap 3: actuele base supply ophalen uit Floriday (per week)
    // tradeItemId → weekKey → numberOfPieces
    const supplyMap = new Map<string, Map<string, number>>()

    try {
      const weekSupplies = await Promise.all(
        weeks.map(w => getWeeklyBaseSupplies(w.year, w.week).catch(() => []))
      )

      for (let i = 0; i < weeks.length; i++) {
        const wk = weekHeaders[i]
        for (const supply of weekSupplies[i]) {
          if (!supplyMap.has(supply.tradeItemId)) {
            supplyMap.set(supply.tradeItemId, new Map())
          }
          supplyMap.get(supply.tradeItemId)!.set(wk, supply.numberOfPieces)
        }
      }
    } catch (err) {
      console.warn('Kon base supply data niet ophalen uit Floriday:', err)
    }

    // Combineer product data + mapping status + alt sku + vbn + weekstocks
    const result = products.map(p => {
      const m = mappingMap.get(p.idproduct)
      const tradeItemId = m?.floriday_trade_item_id ?? null

      // Weekvoorraad uit Floriday
      const weekStocks: Record<string, number> = {}
      if (tradeItemId) {
        const tradeSupply = supplyMap.get(tradeItemId)
        if (tradeSupply) {
          for (const wh of weekHeaders) {
            const qty = tradeSupply.get(wh)
            if (qty !== undefined) weekStocks[wh] = qty
          }
        }
      }

      return {
        picqerProductId: p.idproduct,
        productcode: p.productcode,
        name: p.name,
        altSku: m?.alt_sku ?? null,
        tradeItemId,
        tradeItemName: m?.floriday_trade_item_name ?? null,
        supplierArticleCode: m?.floriday_supplier_article_code ?? null,
        matchMethod: m?.match_method ?? null,
        vbnCode: m?.vbn_product_code ?? null,
        lastSyncedAt: m?.last_stock_sync_at ?? null,
        weekStocks,
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
