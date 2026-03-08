// ══════════════════════════════════════════════════════════════
// Floriday Catalog Supply Sync Service
// ══════════════════════════════════════════════════════════════
//
// Synchroniseert de "Aantal stuks" (numberOfPieces) in de
// Floriday catalogus via het Bulk Base Supply PUT endpoint.
//
// Multi-week sync: pusht voorraad voor 6 weken vooruit.
// Per week N: free_stock + POs(week N) + POs(week N+1)
//
// Bulk PUT endpoint: PUT /trade-items/base-supply/{year}/{week}
// Max 50 items per call, upsert semantiek, prijs optioneel.
// Reduceert ~306 API calls naar 6 (1 per week).

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from './config'
import { putWeeklyBaseSuppliesBulk, getWeeklyBaseSupplies, patchWeeklyBaseSupplyQuantity, editTradeItemAvailabilityPerWeek } from './client'
import { calcExpectedStockByWeek, getFloridayProducts, type WeekStockResult } from './stock-service'
import { getProductFull } from '@/lib/picqer/client'
import { findTradeItemByArticleCode } from './sync/trade-item-sync'
import { getNextNWeeks, weekKey } from './utils'
import type { BulkBaseSupplyItem } from './types'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875
const SYNC_WEEKS = 6
const BULK_CHUNK_SIZE = 50  // Floriday max per bulk PUT call

// ─── Kill switch ────────────────────────────────────────────

export function isCatalogSupplySyncDisabled(): boolean {
  return process.env.FLORIDAY_CATALOG_SUPPLY_SYNC_DISABLED === 'true'
}

export function isAvailabilitySyncDisabled(): boolean {
  return process.env.FLORIDAY_AVAILABILITY_SYNC_DISABLED === 'true'
}

// ─── Product → Trade Item mapping ────────────────────────────

/**
 * Zoek het tradeItemId voor een Picqer product.
 * Kijkt eerst in product_mapping, daarna auto-match via alt SKU / productcode.
 */
async function resolveTradeItemId(picqerProductId: number): Promise<string | null> {
  const env = getFloridayEnv()

  // 1. Zoek in bestaande mapping
  const { data: mapping } = await supabase
    .schema('floriday')
    .from('product_mapping')
    .select('floriday_trade_item_id')
    .eq('picqer_product_id', picqerProductId)
    .eq('environment', env)
    .eq('is_active', true)
    .single()

  if (mapping?.floriday_trade_item_id) {
    return mapping.floriday_trade_item_id
  }

  // 2. Auto-match via alt SKU / productcode
  const product = await getProductFull(picqerProductId)
  const altSku = product.productfields?.find(
    f => f.idproductfield === PICQER_FIELD_ALTERNATIEVE_SKU
  )?.value

  const searchCodes = [altSku, product.productcode].filter(Boolean) as string[]

  let tradeItem: { trade_item_id: string; name: string | null } | null = null
  let matchedCode: string | null = null

  for (const code of searchCodes) {
    tradeItem = await findTradeItemByArticleCode(code)
    if (tradeItem) {
      matchedCode = code
      break
    }
  }

  if (!tradeItem) {
    console.warn(
      `Auto-match mislukt voor product ${picqerProductId} (${product.productcode}). ` +
      `Probeerde: ${searchCodes.join(', ')}`
    )
    return null
  }

  // Sla mapping op
  await supabase
    .schema('floriday')
    .from('product_mapping')
    .upsert(
      {
        picqer_product_id: picqerProductId,
        picqer_product_code: product.productcode,
        floriday_trade_item_id: tradeItem.trade_item_id,
        environment: env,
        floriday_supplier_article_code: matchedCode,
        floriday_trade_item_name: tradeItem.name,
        match_method: 'auto_match',
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'floriday_trade_item_id,environment' }
    )

  console.log(
    `Auto-match: product ${picqerProductId} → trade item ${tradeItem.trade_item_id} (via "${matchedCode}")`
  )

  return tradeItem.trade_item_id
}

// ─── Types ───────────────────────────────────────────────────

export interface WeekSyncDetail {
  year: number
  week: number
  totalStock: number
  action: 'bulk_put' | 'skipped_frozen' | 'skipped_unmapped' | 'error' | 'availability_set' | 'availability_error'
  error?: string
}

export interface CatalogSyncResult {
  success: boolean
  picqerProductId: number
  productcode?: string
  name?: string
  tradeItemId?: string
  weekResults: WeekSyncDetail[]
  error?: string
}

export interface BulkSyncResult {
  success: boolean
  synced: number
  skipped: number
  errors: number
  frozenWeeks: string[]
  details: CatalogSyncResult[]
}

// ─── Internal: resolve + calc stock voor producten ──────────

interface ResolvedProduct {
  picqerProductId: number
  productcode: string
  name: string
  tradeItemId: string
  weekStocks: WeekStockResult[]
}

/**
 * Resolve trade item IDs en bereken stock per week voor een lijst producten.
 * Producten zonder mapping worden overgeslagen (returned in skipped).
 */
async function resolveAndCalcProducts(
  picqerProductIds: number[]
): Promise<{
  resolved: ResolvedProduct[]
  skipped: CatalogSyncResult[]
}> {
  const products = await getFloridayProducts()
  const productMap = new Map(products.map(p => [p.idproduct, p]))

  const resolved: ResolvedProduct[] = []
  const skipped: CatalogSyncResult[] = []

  // Process in batches of 3 (rate limit friendly)
  for (let i = 0; i < picqerProductIds.length; i += 3) {
    const batch = picqerProductIds.slice(i, i + 3)
    const results = await Promise.all(
      batch.map(async (pid) => {
        const product = productMap.get(pid)

        // Skip products not in the Kunstplant-tagged list (safety net)
        if (!product) {
          skipped.push({
            success: false,
            picqerProductId: pid,
            weekResults: [],
            error: 'Product mist vereiste tags (Kunstplant + Floriday product)',
          })
          return null
        }

        const tradeItemId = await resolveTradeItemId(pid)

        if (!tradeItemId) {
          skipped.push({
            success: false,
            picqerProductId: pid,
            productcode: product?.productcode,
            name: product?.name,
            weekResults: [],
            error: 'Geen Floriday trade item mapping gevonden',
          })
          return null
        }

        const weekStocks = await calcExpectedStockByWeek(pid)

        return {
          picqerProductId: pid,
          productcode: product?.productcode ?? '',
          name: product?.name ?? '',
          tradeItemId,
          weekStocks,
        }
      })
    )

    for (const r of results) {
      if (r) resolved.push(r)
    }
  }

  return { resolved, skipped }
}

// ─── Bulk sync via bulk PUT endpoint ─────────────────────────

/**
 * Sync catalog supply via bulk PUT voor de opgegeven producten.
 * 1 bulk PUT per week (max 50 items, chunked als meer).
 * HTTP 423 = frozen week, skip en ga door.
 */
async function executeBulkSync(
  resolved: ResolvedProduct[]
): Promise<{
  weekResults: Map<number, WeekSyncDetail[]>  // picqerProductId → details
  frozenWeeks: Set<string>
  hasErrors: boolean
}> {
  const weeks = getNextNWeeks(SYNC_WEEKS)
  const weekResults = new Map<number, WeekSyncDetail[]>()
  const frozenWeeks = new Set<string>()
  let hasErrors = false

  // Init weekResults per product
  for (const p of resolved) {
    weekResults.set(p.picqerProductId, [])
  }

  // Per week: bouw items array, preserveer prijzen, chunk, bulk PUT
  for (const w of weeks) {
    const wk = weekKey(w.year, w.week)

    // Bouw items voor deze week
    const items: Array<{ product: ResolvedProduct; item: BulkBaseSupplyItem; totalStock: number }> = []

    for (const product of resolved) {
      const weekStock = product.weekStocks.find(ws => ws.year === w.year && ws.week === w.week)
      if (!weekStock) continue

      items.push({
        product,
        item: {
          tradeItemId: product.tradeItemId,
          numberOfPieces: weekStock.totalStock,
          manualPriceGroupPrices: [],
        },
        totalStock: weekStock.totalStock,
      })
    }

    if (items.length === 0) continue

    // Bestaande base supplies ophalen om prijzen te preserveren
    try {
      const existingSupplies = await getWeeklyBaseSupplies(w.year, w.week)
      const priceMap = new Map(
        existingSupplies
          .filter(s => s.basePricePerPiece && s.basePricePerPiece.value > 0)
          .map(s => [s.tradeItemId, s.basePricePerPiece!])
      )

      for (const entry of items) {
        const existingPrice = priceMap.get(entry.item.tradeItemId)
        if (existingPrice) {
          entry.item.basePricePerPiece = existingPrice
        }
      }

      if (priceMap.size > 0) {
        console.log(`${wk}: ${priceMap.size} bestaande prijzen gepreserveerd`)
      }
    } catch (err) {
      // Kon prijzen niet ophalen — ga door zonder prijspreservatie
      console.warn(`${wk}: kon bestaande base supplies niet ophalen, prijzen worden mogelijk gereset`)
    }

    // Chunk in batches van 50
    const chunks: typeof items[] = []
    for (let i = 0; i < items.length; i += BULK_CHUNK_SIZE) {
      chunks.push(items.slice(i, i + BULK_CHUNK_SIZE))
    }

    try {
      for (const chunk of chunks) {
        await putWeeklyBaseSuppliesBulk(
          w.year,
          w.week,
          chunk.map(c => c.item)
        )
      }

      // Success: registreer bulk_put per product
      for (const { product, totalStock } of items) {
        weekResults.get(product.picqerProductId)!.push({
          year: w.year,
          week: w.week,
          totalStock,
          action: 'bulk_put',
        })
      }

      console.log(`Bulk PUT ${wk}: ${items.length} items gesynchroniseerd`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      if (message.includes('423') || message.includes('weeklist-closed')) {
        // Week gesloten voor bulk PUT — probeer PATCH per product (wijzigt alleen qty, niet prijs)
        frozenWeeks.add(wk)
        console.log(`Bulk PUT ${wk}: gesloten, fallback naar PATCH per product (${items.length} producten)`)

        for (const { product, totalStock } of items) {
          try {
            await patchWeeklyBaseSupplyQuantity(product.tradeItemId, w.year, w.week, totalStock)
            weekResults.get(product.picqerProductId)!.push({
              year: w.year,
              week: w.week,
              totalStock,
              action: 'bulk_put',
            })
          } catch (patchErr) {
            const patchMsg = patchErr instanceof Error ? patchErr.message : String(patchErr)
            if (patchMsg.includes('423')) {
              // PATCH ook geblokkeerd — week is volledig frozen
              weekResults.get(product.picqerProductId)!.push({
                year: w.year,
                week: w.week,
                totalStock,
                action: 'skipped_frozen',
              })
            } else {
              weekResults.get(product.picqerProductId)!.push({
                year: w.year,
                week: w.week,
                totalStock,
                action: 'error',
                error: `PATCH fallback mislukt: ${patchMsg}`,
              })
              hasErrors = true
            }
          }
        }
      } else {
        hasErrors = true
        for (const { product, totalStock } of items) {
          weekResults.get(product.picqerProductId)!.push({
            year: w.year,
            week: w.week,
            totalStock,
            action: 'error',
            error: message,
          })
        }
        console.error(`Bulk PUT ${wk}: fout — ${message}`)
      }
    }
  }

  // ── Availability per week toggle (best-effort) ───────────────
  if (!isAvailabilitySyncDisabled()) {
    for (const w of weeks) {
      const wk = weekKey(w.year, w.week)

      // Groepeer trade item IDs per availability status
      const availableIds: string[] = []
      const unavailableIds: string[] = []

      for (const product of resolved) {
        const weekStock = product.weekStocks.find(ws => ws.year === w.year && ws.week === w.week)
        if (!weekStock) continue

        // Alleen availability togglen voor producten waar de base supply succesvol gepusht is
        const prodResults = weekResults.get(product.picqerProductId) ?? []
        const weekPushed = prodResults.some(r => r.year === w.year && r.week === w.week && r.action === 'bulk_put')
        if (!weekPushed) continue

        if (weekStock.totalStock > 0) {
          availableIds.push(product.tradeItemId)
        } else {
          unavailableIds.push(product.tradeItemId)
        }
      }

      const weekObj = { week: w.week, year: w.year }

      // Bulk PUT: available
      if (availableIds.length > 0) {
        try {
          await editTradeItemAvailabilityPerWeek(availableIds, weekObj, weekObj, true)
          console.log(`Availability ${wk}: ${availableIds.length} producten → beschikbaar`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Availability ${wk} (available) fout: ${msg}`)
          // Registreer error per product — best-effort, laat sync niet falen
          for (const product of resolved) {
            if (availableIds.includes(product.tradeItemId)) {
              weekResults.get(product.picqerProductId)!.push({
                year: w.year, week: w.week, totalStock: 0,
                action: 'availability_error', error: msg,
              })
            }
          }
          hasErrors = true
        }
      }

      // Bulk PUT: unavailable
      if (unavailableIds.length > 0) {
        try {
          await editTradeItemAvailabilityPerWeek(unavailableIds, weekObj, weekObj, false)
          console.log(`Availability ${wk}: ${unavailableIds.length} producten → niet beschikbaar`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`Availability ${wk} (unavailable) fout: ${msg}`)
          for (const product of resolved) {
            if (unavailableIds.includes(product.tradeItemId)) {
              weekResults.get(product.picqerProductId)!.push({
                year: w.year, week: w.week, totalStock: 0,
                action: 'availability_error', error: msg,
              })
            }
          }
          hasErrors = true
        }
      }
    }
  } else {
    console.log('Availability sync overgeslagen (FLORIDAY_AVAILABILITY_SYNC_DISABLED=true)')
  }

  return { weekResults, frozenWeeks, hasErrors }
}

// ─── Public: sync alle kunstplant-producten ──────────────────

/**
 * Sync catalog supply voor alle producten met tag "kunstplant",
 * voor de komende 6 weken via bulk PUT.
 */
export async function syncAllKunstplantStock(): Promise<BulkSyncResult> {
  if (isCatalogSupplySyncDisabled()) {
    console.log('Catalog supply sync is uitgeschakeld (FLORIDAY_CATALOG_SUPPLY_SYNC_DISABLED=true)')
    return { success: true, synced: 0, skipped: 0, errors: 0, frozenWeeks: [], details: [] }
  }

  const products = await getFloridayProducts()
  const productIds = products.map(p => p.idproduct)
  console.log(`Catalog supply bulk sync: ${products.length} kunstplant-producten, ${SYNC_WEEKS} weken`)

  return syncSelectedProductsBulk(productIds)
}

// ─── Public: sync geselecteerde producten ────────────────────

/**
 * Sync catalog supply voor geselecteerde Picqer producten via bulk PUT.
 * Gebruikt door de CatalogSupplyPanel UI.
 */
export async function syncSelectedProductsBulk(
  picqerProductIds: number[]
): Promise<BulkSyncResult> {
  if (picqerProductIds.length === 0) {
    return { success: true, synced: 0, skipped: 0, errors: 0, frozenWeeks: [], details: [] }
  }

  // 1. Resolve trade item IDs + bereken stock per week
  const { resolved, skipped } = await resolveAndCalcProducts(picqerProductIds)
  console.log(`Resolved: ${resolved.length} producten, overgeslagen: ${skipped.length}`)

  if (resolved.length === 0) {
    return {
      success: skipped.length === 0,
      synced: 0,
      skipped: skipped.length,
      errors: 0,
      frozenWeeks: [],
      details: skipped,
    }
  }

  // 2. Bulk PUT per week
  const { weekResults, frozenWeeks, hasErrors } = await executeBulkSync(resolved)

  // 3. Update product_mapping timestamps
  const env = getFloridayEnv()
  const now = new Date().toISOString()

  await Promise.all(
    resolved.map(async (p) => {
      const firstWeek = p.weekStocks[0]
      await supabase
        .schema('floriday')
        .from('product_mapping')
        .update({
          last_synced_freestock: firstWeek?.totalStock ?? 0,
          last_stock_sync_at: now,
        })
        .eq('picqer_product_id', p.picqerProductId)
        .eq('environment', env)
    })
  )

  // 4. Build details
  const details: CatalogSyncResult[] = [
    ...resolved.map(p => {
      const results = weekResults.get(p.picqerProductId) ?? []
      const productErrors = results.filter(r => r.action === 'error')
      return {
        success: productErrors.length === 0,
        picqerProductId: p.picqerProductId,
        productcode: p.productcode,
        name: p.name,
        tradeItemId: p.tradeItemId,
        weekResults: results,
      }
    }),
    ...skipped,
  ]

  const synced = resolved.filter(p => {
    const results = weekResults.get(p.picqerProductId) ?? []
    return results.some(r => r.action === 'bulk_put')
  }).length

  console.log(
    `Catalog supply bulk sync klaar: ${synced} gesynchroniseerd, ${skipped.length} overgeslagen` +
    (frozenWeeks.size > 0 ? `, frozen weken: ${[...frozenWeeks].join(', ')}` : '')
  )

  return {
    success: !hasErrors && skipped.length === 0,
    synced,
    skipped: skipped.length,
    errors: hasErrors ? details.filter(d => !d.success && !d.error?.includes('mapping')).length : 0,
    frozenWeeks: [...frozenWeeks],
    details,
  }
}
