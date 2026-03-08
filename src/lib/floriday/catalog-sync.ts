// ══════════════════════════════════════════════════════════════
// Floriday Catalog Sync: Bulk Auto-Map
// ══════════════════════════════════════════════════════════════
//
// Matcht ongemapte Picqer producten (met alt_sku) automatisch
// aan Floriday trade items op basis van supplier_article_code.
// Wordt dagelijks gedraaid door syncFloridayCatalog Inngest functie.

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

export interface AutoMapResult {
  picqerProductId: number
  productcode: string
  name: string
  altSku: string
  status: 'mapped' | 'no_match'
  tradeItemId?: string
  tradeItemName?: string
}

export interface BulkAutoMapResult {
  mapped: number
  noMatch: number
  alreadyMapped: number
  details: AutoMapResult[]
}

/**
 * Bulk auto-map: koppel ongemapte Picqer producten aan Floriday trade items.
 *
 * 1. Haal producten met alt_sku op die nog geen mapping hebben
 * 2. Match op trade_items.supplier_article_code (exact match)
 * 3. Upsert nieuwe mappings naar product_mapping
 */
export async function bulkAutoMap(): Promise<BulkAutoMapResult> {
  const env = getFloridayEnv()

  // 1. Haal alle producten met alt_sku uit de index
  const { data: allWithAltSku, error: indexError } = await supabase
    .schema('floriday')
    .from('picqer_product_index')
    .select('picqer_product_id, productcode, alt_sku, name')
    .not('alt_sku', 'is', null)

  if (indexError) {
    throw new Error(`Failed to fetch product index: ${indexError.message}`)
  }

  if (!allWithAltSku || allWithAltSku.length === 0) {
    console.log('Bulk auto-map: geen producten met alt_sku gevonden')
    return { mapped: 0, noMatch: 0, alreadyMapped: 0, details: [] }
  }

  // 2. Haal bestaande actieve mappings op
  const { data: existingMappings } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id')
    .eq('environment', env)
    .eq('is_active', true)

  const mappedIds = new Set((existingMappings || []).map(m => m.picqer_product_id))
  const unmapped = allWithAltSku.filter(p => !mappedIds.has(p.picqer_product_id))
  const alreadyMappedCount = allWithAltSku.length - unmapped.length

  if (unmapped.length === 0) {
    console.log(`Bulk auto-map: alle ${alreadyMappedCount} producten zijn al gemapt`)
    return { mapped: 0, noMatch: 0, alreadyMapped: alreadyMappedCount, details: [] }
  }

  console.log(`Bulk auto-map: ${unmapped.length} ongemapte producten, ${alreadyMappedCount} al gemapt`)

  // 3. Match tegen trade_items op supplier_article_code
  const altSkus = unmapped.map(p => p.alt_sku!)
  const tradeItemMap = new Map<string, { trade_item_id: string; name: string | null }>()

  for (let i = 0; i < altSkus.length; i += 500) {
    const chunk = altSkus.slice(i, i + 500)
    const { data: tradeItems } = await supabase
      .schema('floriday')
      .from('trade_items')
      .select('trade_item_id, supplier_article_code, name')
      .eq('environment', env)
      .in('supplier_article_code', chunk)

    for (const ti of tradeItems || []) {
      if (ti.supplier_article_code) {
        tradeItemMap.set(ti.supplier_article_code, {
          trade_item_id: ti.trade_item_id,
          name: ti.name,
        })
      }
    }
  }

  // 4. Build results en mappings
  const details: AutoMapResult[] = []
  const mappingsToUpsert: Record<string, unknown>[] = []

  for (const p of unmapped) {
    const tradeItem = tradeItemMap.get(p.alt_sku!)

    if (tradeItem) {
      details.push({
        picqerProductId: p.picqer_product_id,
        productcode: p.productcode,
        name: p.name ?? '',
        altSku: p.alt_sku!,
        status: 'mapped',
        tradeItemId: tradeItem.trade_item_id,
        tradeItemName: tradeItem.name ?? undefined,
      })

      mappingsToUpsert.push({
        picqer_product_id: p.picqer_product_id,
        picqer_product_code: p.productcode,
        floriday_trade_item_id: tradeItem.trade_item_id,
        floriday_supplier_article_code: p.alt_sku,
        floriday_trade_item_name: tradeItem.name,
        environment: env,
        match_method: 'auto_map',
        is_active: true,
        updated_at: new Date().toISOString(),
      })
    } else {
      details.push({
        picqerProductId: p.picqer_product_id,
        productcode: p.productcode,
        name: p.name ?? '',
        altSku: p.alt_sku!,
        status: 'no_match',
      })
    }
  }

  // 5. Upsert nieuwe mappings in batches
  for (let i = 0; i < mappingsToUpsert.length; i += 500) {
    const batch = mappingsToUpsert.slice(i, i + 500)
    const { error } = await supabase
      .schema('floriday')
      .from('product_mapping')
      .upsert(batch, { onConflict: 'floriday_trade_item_id,environment' })

    if (error) {
      console.error(`Auto-map upsert batch ${i} failed:`, error.message)
    }
  }

  const mapped = details.filter(d => d.status === 'mapped').length
  const noMatch = details.filter(d => d.status === 'no_match').length

  console.log(`Bulk auto-map klaar: ${mapped} nieuw gemapt, ${noMatch} geen match, ${alreadyMappedCount} al gemapt`)

  return {
    mapped,
    noMatch,
    alreadyMapped: alreadyMappedCount,
    details,
  }
}
