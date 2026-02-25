// ══════════════════════════════════════════════════════════════
// Product Resolver: supplierArticleCode → Picqer idproduct
// ══════════════════════════════════════════════════════════════
//
// Zoekstrategie:
//   1. Check product_mapping cache (bestaande koppeling)
//   2. Check picqer_product_index tabel (alt_sku of productcode)
//   3. Direct Picqer API search als fallback (zoekt op productcode/naam/barcode)
//   4. Als niet in index: on-demand full sync + retry
//
// Picqer's search API doorzoekt GEEN custom productfields.
// Daarom houden we een database index bij met alt_sku mapping.

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import { searchProducts, getAllActiveProducts } from '@/lib/picqer/client'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875

interface ResolvedProduct {
  idproduct: number
  productcode: string
  name: string
}

// Throttle: max 1 full sync per 30 minuten
let lastSyncTime = 0
const SYNC_COOLDOWN_MS = 30 * 60 * 1000

/**
 * Full sync: haal ALLE actieve Picqer producten op en update de index.
 */
export async function syncProductIndex(): Promise<{ synced: number }> {
  const now = Date.now()
  if (now - lastSyncTime < SYNC_COOLDOWN_MS) {
    console.log('Product index sync overgeslagen (cooldown)')
    return { synced: 0 }
  }
  lastSyncTime = now

  console.log('Syncing picqer_product_index (alle actieve producten)...')

  const allProducts = await getAllActiveProducts()

  // Deduplicate alt_sku: if multiple products share the same alt_sku, only keep the first
  const seenAltSkus = new Set<string>()
  const rows = allProducts.map(p => {
    let altSku = p.productfields?.find(
      f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
    )?.value || null

    if (altSku) {
      if (seenAltSkus.has(altSku)) {
        console.warn(`Duplicate alt_sku "${altSku}" voor product ${p.productcode}, overgeslagen`)
        altSku = null
      } else {
        seenAltSkus.add(altSku)
      }
    }

    return {
      picqer_product_id: p.idproduct,
      productcode: p.productcode,
      alt_sku: altSku,
      name: p.name,
      synced_at: new Date().toISOString(),
    }
  })

  // Upsert in batches van 500
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await supabase
      .schema('floriday')
      .from('picqer_product_index')
      .upsert(batch, { onConflict: 'picqer_product_id' })

    if (error) {
      console.error(`Error upserting picqer_product_index batch ${i}:`, error)
    }
  }

  console.log(`Product index gesynchroniseerd: ${rows.length} producten`)
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

  // 3. Fallback: check op productcode
  if (!match) {
    match = await lookupByProductcode(supplierArticleCode)
  }

  // 4. Direct Picqer API search (zoekt op productcode/naam/barcode)
  if (!match) {
    match = await searchPicqerDirect(supplierArticleCode)
  }

  // 5. Niet gevonden → trigger full sync en retry
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

  // 6. Cache in product_mapping voor volgende keer
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

/**
 * Direct Picqer API search als fallback.
 * Zoekt op productcode (Picqer search doorzoekt name, productcode, barcode).
 * Als gevonden: voeg toe aan index voor volgende keer.
 */
async function searchPicqerDirect(articleCode: string): Promise<ResolvedProduct | null> {
  console.log(`Direct Picqer search voor "${articleCode}"...`)
  const results = await searchProducts(articleCode)

  // Exacte match op productcode of alt_sku
  const exact = results.find(p => {
    if (p.productcode === articleCode) return true
    const altSku = p.productfields?.find(
      f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
    )?.value
    return altSku === articleCode
  })

  if (!exact) return null

  // Voeg toe aan index
  const altSku = exact.productfields?.find(
    f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
  )?.value || null

  await supabase
    .schema('floriday')
    .from('picqer_product_index')
    .upsert({
      picqer_product_id: exact.idproduct,
      productcode: exact.productcode,
      alt_sku: altSku,
      name: exact.name,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'picqer_product_id' })

  console.log(`Product gevonden via Picqer search: ${exact.productcode} → ${exact.name}`)
  return {
    idproduct: exact.idproduct,
    productcode: exact.productcode,
    name: exact.name,
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
