import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'

export const dynamic = 'force-dynamic'

/**
 * POST /api/floriday/product-mapping/auto-map
 *
 * Bulk auto-map: matcht picqer_product_index.alt_sku op trade_items.supplier_article_code
 * voor producten die nog niet gemapped zijn.
 */
export async function POST() {
  try {
    const env = getFloridayEnv()

    // Stap 1: vind matchbare producten via SQL join
    const { data: matches, error: matchError } = await supabase.rpc('floriday_auto_match', {
      p_environment: env,
    })

    if (matchError) {
      // Fallback: handmatige query als RPC niet bestaat
      console.warn('RPC floriday_auto_match niet beschikbaar, fallback naar handmatige query')
      return await manualAutoMap(env)
    }

    if (!matches || matches.length === 0) {
      return NextResponse.json({
        success: true,
        mapped: 0,
        alreadyMapped: 0,
        message: 'Geen nieuwe matches gevonden',
      })
    }

    // Stap 2: bulk insert in product_mapping
    const rows = matches.map((m: {
      picqer_product_id: number
      productcode: string
      alt_sku: string
      trade_item_id: string
      name: string
      supplier_article_code: string
      vbn_product_code: number | null
    }) => ({
      picqer_product_id: m.picqer_product_id,
      picqer_product_code: m.productcode,
      floriday_trade_item_id: m.trade_item_id,
      floriday_trade_item_name: m.name,
      floriday_supplier_article_code: m.supplier_article_code,
      floriday_vbn_product_code: m.vbn_product_code,
      match_method: 'auto_match',
      is_active: true,
      environment: env,
    }))

    const { error: insertError } = await supabase
      .schema('floriday')
      .from('product_mapping')
      .upsert(rows, { onConflict: 'picqer_product_id' })

    if (insertError) {
      console.error('Auto-map insert error:', insertError)
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      mapped: rows.length,
      message: `${rows.length} producten automatisch gemapped`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * Fallback: handmatige join query als RPC niet bestaat
 */
async function manualAutoMap(env: string) {
  // Haal alle producten op uit index die een alt_sku hebben
  const { data: indexProducts, error: idxError } = await supabase
    .schema('floriday')
    .from('picqer_product_index')
    .select('picqer_product_id, productcode, alt_sku')
    .not('alt_sku', 'is', null)

  if (idxError) {
    return NextResponse.json({ success: false, error: idxError.message }, { status: 500 })
  }

  if (!indexProducts || indexProducts.length === 0) {
    return NextResponse.json({ success: true, mapped: 0, message: 'Geen producten met alt_sku gevonden' })
  }

  // Haal bestaande mappings op
  const { data: existingMappings } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('picqer_product_id')
    .eq('environment', env)
    .eq('is_active', true)

  const mappedIds = new Set((existingMappings ?? []).map(m => m.picqer_product_id))

  // Filter producten die al gemapped zijn
  const unmappedProducts = indexProducts.filter(p => !mappedIds.has(p.picqer_product_id))

  if (unmappedProducts.length === 0) {
    return NextResponse.json({
      success: true,
      mapped: 0,
      alreadyMapped: indexProducts.length,
      message: 'Alle producten met alt_sku zijn al gemapped',
    })
  }

  // Haal trade items op
  const altSkus = unmappedProducts.map(p => p.alt_sku).filter(Boolean) as string[]
  const { data: tradeItems, error: tiError } = await supabase
    .schema('floriday')
    .from('trade_items')
    .select('trade_item_id, supplier_article_code, name, vbn_product_code')
    .eq('environment', env)
    .in('supplier_article_code', altSkus)

  if (tiError) {
    return NextResponse.json({ success: false, error: tiError.message }, { status: 500 })
  }

  if (!tradeItems || tradeItems.length === 0) {
    return NextResponse.json({
      success: true,
      mapped: 0,
      message: 'Geen matching trade items gevonden',
    })
  }

  // Maak lookup: supplier_article_code → trade item
  const tiMap = new Map(tradeItems.map(ti => [ti.supplier_article_code, ti]))

  // Match en bouw insert rows
  const rows = unmappedProducts
    .map(p => {
      const ti = tiMap.get(p.alt_sku!)
      if (!ti) return null
      return {
        picqer_product_id: p.picqer_product_id,
        picqer_product_code: p.productcode,
        floriday_trade_item_id: ti.trade_item_id,
        floriday_trade_item_name: ti.name,
        floriday_supplier_article_code: ti.supplier_article_code,
        floriday_vbn_product_code: ti.vbn_product_code,
        match_method: 'auto_match',
        is_active: true,
        environment: env,
      }
    })
    .filter(Boolean)

  if (rows.length === 0) {
    return NextResponse.json({
      success: true,
      mapped: 0,
      message: 'Geen matches gevonden tussen alt_sku en supplier_article_code',
    })
  }

  const { error: insertError } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .upsert(rows, { onConflict: 'picqer_product_id' })

  if (insertError) {
    console.error('Auto-map manual insert error:', insertError)
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    mapped: rows.length,
    alreadyMapped: mappedIds.size,
    message: `${rows.length} producten automatisch gemapped`,
  })
}
