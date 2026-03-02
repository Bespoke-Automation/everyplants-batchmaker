// ══════════════════════════════════════════════════════════════
// Floriday Catalog Supply Sync Service
// ══════════════════════════════════════════════════════════════
//
// Synchroniseert de "Aantal stuks" (numberOfPieces) in de
// Floriday catalogus via het Base Supply PATCH endpoint.
//
// Berekening: vrije voorraad (warehouse 9979, excl PPS)
//           + inkooporders die binnen 7 kalenderdagen binnenkomen
//
// Vervangt het batch-push systeem als primaire sync methode
// voor kunstplant-producten.

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from './config'
import { patchWeeklyBaseSupplyQuantity } from './client'
import { calcExpectedStock, getFloridayProducts } from './stock-service'
import { getProductFull } from '@/lib/picqer/client'
import { findTradeItemByArticleCode } from './sync/trade-item-sync'

const PICQER_FIELD_ALTERNATIEVE_SKU = 4875

// ─── ISO Week berekening ─────────────────────────────────────

/**
 * Bereken het ISO 8601 weeknummer voor een datum.
 * ISO weken starten op maandag; week 1 bevat de eerste donderdag van het jaar.
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Zet naar dichtstbijzijnde donderdag: huidige dag + 4 - dagnummer (ma=1, zo=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return { year: d.getUTCFullYear(), week: weekNo }
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

export interface CatalogSyncResult {
  success: boolean
  picqerProductId: number
  tradeItemId?: string
  freeStock?: number
  expectedFromPOs?: number
  totalStock?: number
  year?: number
  week?: number
  error?: string
  dryRun?: boolean
}

export interface BulkSyncResult {
  success: boolean
  synced: number
  skipped: number
  errors: number
  details: CatalogSyncResult[]
}

// ─── Per-product sync ────────────────────────────────────────

/**
 * Sync de catalog supply (numberOfPieces) voor een enkel Picqer product naar Floriday.
 *
 * 1. Bereken stock (vrije voorraad + 7-dag POs)
 * 2. Zoek tradeItemId via product_mapping (met auto-match fallback)
 * 3. Bepaal huidige ISO week
 * 4. PATCH numberOfPieces naar Floriday
 * 5. Update product_mapping met last_synced_freestock + timestamp
 */
export async function syncProductCatalogSupply(
  picqerProductId: number,
  options?: { dryRun?: boolean }
): Promise<CatalogSyncResult> {
  const dryRun = options?.dryRun ?? false

  try {
    // 1. Bereken stock
    const stockResult = await calcExpectedStock(picqerProductId)
    const { freeStock, expectedFromPOs, totalStock } = stockResult

    // 2. Zoek tradeItemId
    const tradeItemId = await resolveTradeItemId(picqerProductId)
    if (!tradeItemId) {
      return {
        success: false,
        picqerProductId,
        freeStock,
        expectedFromPOs,
        totalStock,
        error: 'Geen Floriday trade item mapping gevonden',
        dryRun,
      }
    }

    // 3. Bepaal huidige ISO week
    const { year, week } = getISOWeek(new Date())

    // 4. PATCH naar Floriday (tenzij dry run)
    if (!dryRun) {
      try {
        await patchWeeklyBaseSupplyQuantity(tradeItemId, year, week, totalStock)
        console.log(
          `Catalog supply bijgewerkt: product ${picqerProductId} → ` +
          `${totalStock} stuks (week ${year}-W${String(week).padStart(2, '0')})`
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // HTTP 423 = pricing freeze
        if (message.includes('423')) {
          return {
            success: false,
            picqerProductId,
            tradeItemId,
            freeStock,
            expectedFromPOs,
            totalStock,
            year,
            week,
            error: `Pricing freeze: week ${year}-W${String(week).padStart(2, '0')} is vergrendeld (na donderdag 10:00 CET)`,
            dryRun,
          }
        }
        throw err
      }

      // 5. Update mapping met sync timestamp
      const env = getFloridayEnv()
      await supabase
        .schema('floriday')
        .from('product_mapping')
        .update({
          last_synced_freestock: totalStock,
          last_stock_sync_at: new Date().toISOString(),
        })
        .eq('picqer_product_id', picqerProductId)
        .eq('environment', env)
    }

    return {
      success: true,
      picqerProductId,
      tradeItemId,
      freeStock,
      expectedFromPOs,
      totalStock,
      year,
      week,
      dryRun,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Catalog supply sync mislukt voor product ${picqerProductId}:`, message)
    return {
      success: false,
      picqerProductId,
      error: message,
      dryRun,
    }
  }
}

// ─── Bulk sync (alle kunstplant-producten) ───────────────────

/**
 * Sync catalog supply voor alle producten met tag "kunstplant".
 */
export async function syncAllKunstplantStock(
  options?: { dryRun?: boolean }
): Promise<BulkSyncResult> {
  const products = await getFloridayProducts()
  console.log(`Catalog supply sync: ${products.length} kunstplant-producten gevonden`)

  const details: CatalogSyncResult[] = []
  let synced = 0
  let skipped = 0
  let errors = 0

  for (const product of products) {
    const result = await syncProductCatalogSupply(product.idproduct, options)
    details.push(result)

    if (result.success) {
      synced++
    } else if (result.error?.includes('mapping')) {
      skipped++
    } else {
      errors++
    }
  }

  console.log(
    `Catalog supply sync klaar: ${synced} gesynchroniseerd, ${skipped} overgeslagen, ${errors} fouten`
  )

  return {
    success: errors === 0,
    synced,
    skipped,
    errors,
    details,
  }
}
