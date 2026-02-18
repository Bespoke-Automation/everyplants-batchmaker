// ══════════════════════════════════════════════════════════════
// Product Resolver: supplierArticleCode → Picqer idproduct
// ══════════════════════════════════════════════════════════════
//
// Matching strategie:
//   Floriday tradeItem.supplierArticleCode (bijv. "13630")
//   → Picqer productfield 4875 "Alternatieve SKU" (bijv. "13630")
//   → idproduct
//
// Resultaten worden gecached in floriday.product_mapping.

import { supabase } from '@/lib/supabase/client'
import { searchProducts } from '@/lib/picqer/client'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875

interface ResolvedProduct {
  idproduct: number
  productcode: string
  name: string
}

/**
 * Resolve a Floriday supplierArticleCode to a Picqer product ID.
 * First checks the cache, then searches Picqer by Alternatieve SKU field.
 */
export async function resolveProduct(
  supplierArticleCode: string,
  tradeItemId?: string,
  productName?: string
): Promise<ResolvedProduct | null> {
  // 1. Check cache
  const cached = await getCachedMapping(supplierArticleCode)
  if (cached) return cached

  // 2. Search Picqer
  const products = await searchProducts(supplierArticleCode)

  // Find product where Alternatieve SKU matches exactly
  const match = products.find(p =>
    p.productfields?.some(
      f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU && f.value === supplierArticleCode
    )
  )

  if (!match) {
    console.warn(`Product niet gevonden voor supplierArticleCode "${supplierArticleCode}"`)
    return null
  }

  const result: ResolvedProduct = {
    idproduct: match.idproduct,
    productcode: match.productcode,
    name: match.name,
  }

  // 3. Cache the mapping
  await cacheMapping(supplierArticleCode, result, tradeItemId, productName)

  return result
}

async function getCachedMapping(articleCode: string): Promise<ResolvedProduct | null> {
  const { data } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id, picqer_product_code, floriday_trade_item_name')
    .eq('floriday_supplier_article_code', articleCode)
    .eq('is_active', true)
    .single()

  if (!data) return null

  return {
    idproduct: data.picqer_product_id,
    productcode: data.picqer_product_code || '',
    name: data.floriday_trade_item_name || '',
  }
}

async function cacheMapping(
  articleCode: string,
  product: ResolvedProduct,
  tradeItemId?: string,
  productName?: string
): Promise<void> {
  const { error } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .upsert(
      {
        floriday_supplier_article_code: articleCode,
        floriday_trade_item_id: tradeItemId || null,
        floriday_trade_item_name: productName || product.name,
        picqer_product_id: product.idproduct,
        picqer_product_code: product.productcode,
        match_method: 'alternatieve_sku',
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_trade_item_id' }
    )

  if (error) {
    console.error('Error caching product mapping:', error)
  }
}
