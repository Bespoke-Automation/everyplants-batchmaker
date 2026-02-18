import { getFacturatieSupabase } from './facturatieClient'
import { supabase } from './client'

export interface SyncResult {
  updated: { name: string; barcode: string; old_cost: number; new_cost: number }[]
  skipped: { barcode: string; reason: string }[]
  errors: { barcode: string; error: string }[]
}

/**
 * Synct material_cost in batchmaker.packagings vanuit facturatie.boxes.
 * Match-key: boxes.sku (facturatie) ↔ packagings.barcode (batchmaker)
 * Alleen packagings met use_in_auto_advice = true worden bijgewerkt.
 *
 * Na de sync gebruikt rankPackagings() in de packaging engine automatisch de
 * bijgewerkte kosten bij gelijke specificity en volume (specifiekst → kleinst → goedkoopst).
 */
export async function syncPackagingCosts(): Promise<SyncResult> {
  const result: SyncResult = { updated: [], skipped: [], errors: [] }
  const facturatieSupabase = getFacturatieSupabase()

  // Haal alle engine-packagings op
  const { data: packagings, error: packagingsError } = await supabase
    .schema('batchmaker')
    .from('packagings')
    .select('id, name, barcode, material_cost')
    .eq('use_in_auto_advice', true)

  if (packagingsError) throw new Error(`Fout bij ophalen packagings: ${packagingsError.message}`)
  if (!packagings?.length) return result

  // Haal actieve dozen op uit facturatie
  const barcodes = [...new Set(packagings.map((p) => p.barcode).filter(Boolean))]
  const { data: boxes, error: boxesError } = await facturatieSupabase
    .from('boxes')
    .select('sku, name, purchase_price_total')
    .eq('active', true)
    .in('sku', barcodes)

  if (boxesError) throw new Error(`Fout bij ophalen facturatie boxes: ${boxesError.message}`)

  // Bouw lookup map: sku → purchase_price_total
  const priceMap = new Map<string, number>(
    (boxes ?? []).map((b) => [b.sku, parseFloat(b.purchase_price_total)])
  )

  // Update elke packaging
  for (const packaging of packagings) {
    if (!packaging.barcode) {
      result.skipped.push({ barcode: '(geen)', reason: `${packaging.name} heeft geen barcode` })
      continue
    }

    const newCost = priceMap.get(packaging.barcode)
    if (newCost === undefined) {
      result.skipped.push({
        barcode: packaging.barcode,
        reason: `Barcode ${packaging.barcode} niet gevonden in facturatie boxes`,
      })
      continue
    }

    const oldCost = parseFloat(packaging.material_cost ?? '0')
    if (oldCost === newCost) {
      result.skipped.push({
        barcode: packaging.barcode,
        reason: `${packaging.name}: kosten ongewijzigd (€${newCost.toFixed(2)})`,
      })
      continue
    }

    const { error: updateError } = await supabase
      .schema('batchmaker')
      .from('packagings')
      .update({ material_cost: newCost })
      .eq('id', packaging.id)

    if (updateError) {
      result.errors.push({
        barcode: packaging.barcode,
        error: `${packaging.name}: ${updateError.message}`,
      })
    } else {
      result.updated.push({
        name: packaging.name,
        barcode: packaging.barcode,
        old_cost: oldCost,
        new_cost: newCost,
      })
    }
  }

  return result
}
