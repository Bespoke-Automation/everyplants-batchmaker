// ══════════════════════════════════════════════════════════════
// Product Resolver: supplierArticleCode → Picqer idproduct
// ══════════════════════════════════════════════════════════════
//
// Zoekstrategie (waterdicht):
//   1. Check product_mapping cache (bestaande koppeling)
//   2. Check picqer_product_index tabel (alt_sku → product)
//   3. Als niet gevonden: on-demand sync van relevante Picqer
//      producten (Floriday tag + recent aangemaakt, alleen met alt_sku)
//   4. Retry lookup na sync
//
// Picqer's search API doorzoekt GEEN custom productfields.
// Daarom houden we een database index bij.

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { getProductsByTag, getRecentProducts } from '@/lib/picqer/client'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875

interface ResolvedProduct {
  idproduct: number
  productcode: string
  name: string
}

// Throttle: max 1 sync per 5 minuten
let lastSyncTime = 0
const SYNC_COOLDOWN_MS = 5 * 60 * 1000

/**
 * On-demand sync: haal relevante Picqer producten op en update de index.
 * Scope: producten met Floriday tag + producten aangemaakt in laatste 60 dagen.
 * Alleen producten met ingevulde Alternatieve SKU worden opgeslagen.
 */
export async function syncProductIndex(): Promise<{ synced: number }> {
  const now = Date.now()
  if (now - lastSyncTime < SYNC_COOLDOWN_MS) {
    console.log('Product index sync overgeslagen (cooldown)')
    return { synced: 0 }
  }
  lastSyncTime = now

  console.log('Syncing picqer_product_index...')

  // 1. Producten met Floriday tag
  const floridayProducts = await getProductsByTag('Floriday')

  // 2. Recent aangemaakte producten (laatste 60 dagen)
  const recentProducts = await getRecentProducts(60)

  // Combineer en dedup op idproduct
  const seen = new Set<number>()
  const allProducts = [...floridayProducts, ...recentProducts].filter(p => {
    if (seen.has(p.idproduct)) return false
    seen.add(p.idproduct)
    return true
  })

  // 3. Filter: alleen producten met ingevulde Alternatieve SKU
  const rows = allProducts
    .map(p => {
      const altSku = p.productfields?.find(
        f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
      )?.value
      if (!altSku) return null
      return {
        picqer_product_id: p.idproduct,
        productcode: p.productcode,
        alt_sku: altSku,
        name: p.name,
        synced_at: new Date().toISOString(),
      }
    })
    .filter(Boolean) as Array<{
      picqer_product_id: number
      productcode: string
      alt_sku: string
      name: string
      synced_at: string
    }>

  if (rows.length > 0) {
    const { error } = await supabase
      .schema('floriday')
      .from('picqer_product_index')
      .upsert(rows, { onConflict: 'picqer_product_id' })

    if (error) {
      console.error('Error upserting picqer_product_index:', error)
    }
  }

  console.log(`Product index gesynchroniseerd: ${rows.length} producten met alt_sku (van ${allProducts.length} totaal)`)
  return { synced: rows.length }
}

/**
 * Resolve a Floriday supplierArticleCode to a Picqer product ID.
 */
export async function resolveProduct(
  supplierArticleCode: string,
  tradeItemId?: string,
  productName?: string
): Promise<ResolvedProduct | null> {
  // 1. Check product_mapping (bestaande koppeling)
  const cached = await getCachedMapping(supplierArticleCode)
  if (cached) return cached

  // 2. Check picqer_product_index op alt_sku
  let match = await lookupByAltSku(supplierArticleCode)

  // 3. Fallback: check op productcode (oude-stijl producten)
  if (!match) {
    match = await lookupByProductcode(supplierArticleCode)
  }

  // 4. Niet gevonden → trigger on-demand sync en retry
  if (!match) {
    const { synced } = await syncProductIndex()
    if (synced > 0) {
      match = await lookupByAltSku(supplierArticleCode)
      if (!match) {
        match = await lookupByProductcode(supplierArticleCode)
      }
    }
  }

  if (!match) {
    console.warn(`Product niet gevonden voor supplierArticleCode "${supplierArticleCode}"`)
    return null
  }

  // 5. Cache in product_mapping voor volgende keer
  await cacheMapping(supplierArticleCode, match, tradeItemId, productName)

  return match
}

// ─── Database lookups ────────────────────────────────────────

async function lookupByAltSku(altSku: string): Promise<ResolvedProduct | null> {
  const { data } = await supabase
    .schema('floriday')
    .from('picqer_product_index')
    .select('picqer_product_id, productcode, name')
    .eq('alt_sku', altSku)
    .single()

  if (!data) return null
  return {
    idproduct: data.picqer_product_id,
    productcode: data.productcode,
    name: data.name,
  }
}

async function lookupByProductcode(code: string): Promise<ResolvedProduct | null> {
  const { data } = await supabase
    .schema('floriday')
    .from('picqer_product_index')
    .select('picqer_product_id, productcode, name')
    .eq('productcode', code)
    .single()

  if (!data) return null
  return {
    idproduct: data.picqer_product_id,
    productcode: data.productcode,
    name: data.name,
  }
}

async function getCachedMapping(articleCode: string): Promise<ResolvedProduct | null> {
  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id, picqer_product_code, floriday_trade_item_name')
    .eq('floriday_supplier_article_code', articleCode)
    .eq('environment', env)
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
  const env = getFloridayEnv()
  const { error } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .upsert(
      {
        floriday_supplier_article_code: articleCode,
        floriday_trade_item_id: tradeItemId || null,
        environment: env,
        floriday_trade_item_name: productName || product.name,
        picqer_product_id: product.idproduct,
        picqer_product_code: product.productcode,
        match_method: 'product_index_lookup',
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_trade_item_id,environment' }
    )

  if (error) {
    console.error('Error caching product mapping:', error)
  }
}
