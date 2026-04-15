/**
 * Record Packing Observations — Fase 1 engine-simplification
 * ──────────────────────────────────────────────────────────
 *
 * Na een succesvolle session-completion: voor elke verzonden doos in de
 * sessie, bouw de productcode-fingerprint van de core-producten (flyers etc.
 * gefilterd) en increment `packing_observations` atomair via de RPC
 * `increment_packing_observation`.
 *
 * Fase 1 = alleen data verzamelen. Er wordt NIETS gelezen uit deze tabel
 * door de productie-engine. De counts worden in fase 2 gebruikt voor
 * parallel-adviseren en in fase 3 om de adviesbron te worden.
 *
 * Niet-blocking: fouten loggen, nooit throwen — een gefaalde observation
 * mag nooit een session-completion stuk maken.
 */

import { supabase } from '@/lib/supabase/client'
import {
  isAccompanying,
  buildProductcodeFingerprint,
  type AccompanyingAttr,
  type ProductLike,
} from '@/lib/engine/accompanying'

interface BoxRow {
  id: string
  picqer_packaging_id: number | null
}

interface BoxProductRow {
  box_id: string
  picqer_product_id: number
  productcode: string
  amount: number
}

interface ProductAttrRow {
  picqer_product_id: number
  product_type: string | null
  classification_status: string | null
}

interface PackagingRow {
  id: string
  idpackaging: number | null
}

/**
 * Main entrypoint. Called from tryCompleteSession after a successful
 * session-completion. Swallows all errors.
 */
export async function recordPackingObservations(
  sessionId: string,
): Promise<void> {
  try {
    // Step 1 — load boxes for this session
    const { data: boxes, error: boxesErr } = await supabase
      .schema('batchmaker')
      .from('packing_session_boxes')
      .select('id, picqer_packaging_id')
      .eq('session_id', sessionId)

    if (boxesErr) {
      console.error('[recordPackingObservations] Failed to load boxes:', boxesErr)
      return
    }
    if (!boxes || boxes.length === 0) return

    const boxRows = boxes as BoxRow[]
    const boxIds = boxRows.map(b => b.id)

    // Step 2 — load all products across those boxes
    const { data: products, error: productsErr } = await supabase
      .schema('batchmaker')
      .from('packing_session_products')
      .select('box_id, picqer_product_id, productcode, amount')
      .in('box_id', boxIds)

    if (productsErr) {
      console.error(
        '[recordPackingObservations] Failed to load box products:',
        productsErr,
      )
      return
    }
    const productRows = (products ?? []) as BoxProductRow[]

    // Step 3 — load product_attributes for all unique picqer_product_ids
    const uniqueProductIds = [
      ...new Set(productRows.map(p => p.picqer_product_id)),
    ]
    const attrByProductId = new Map<number, AccompanyingAttr>()
    if (uniqueProductIds.length > 0) {
      const { data: attrs, error: attrErr } = await supabase
        .schema('batchmaker')
        .from('product_attributes')
        .select('picqer_product_id, product_type, classification_status')
        .in('picqer_product_id', uniqueProductIds)

      if (attrErr) {
        console.error(
          '[recordPackingObservations] Failed to load product_attributes:',
          attrErr,
        )
        // Non-fatal — continue without attributes. isAccompanying still
        // catches short numeric codes + logistics codes.
      } else {
        for (const row of (attrs ?? []) as ProductAttrRow[]) {
          attrByProductId.set(row.picqer_product_id, {
            product_type: row.product_type,
            classification_status: row.classification_status,
          })
        }
      }
    }

    // Step 4 — resolve picqer_packaging_id (int) → packagings.id (uuid)
    const uniquePicqerPackagingIds = [
      ...new Set(
        boxRows
          .map(b => b.picqer_packaging_id)
          .filter((id): id is number => id != null && id > 0),
      ),
    ]
    const packagingUuidByPicqerId = new Map<number, string>()
    if (uniquePicqerPackagingIds.length > 0) {
      const { data: pkgs, error: pkgErr } = await supabase
        .schema('batchmaker')
        .from('packagings')
        .select('id, idpackaging')
        .in('idpackaging', uniquePicqerPackagingIds)

      if (pkgErr) {
        console.error(
          '[recordPackingObservations] Failed to load packagings:',
          pkgErr,
        )
        return
      }
      for (const row of (pkgs ?? []) as PackagingRow[]) {
        if (row.idpackaging != null) {
          packagingUuidByPicqerId.set(row.idpackaging, row.id)
        }
      }
    }

    // Step 5 — group products per box
    const productsByBox = new Map<string, BoxProductRow[]>()
    for (const p of productRows) {
      const existing = productsByBox.get(p.box_id)
      if (existing) existing.push(p)
      else productsByBox.set(p.box_id, [p])
    }

    // Step 6 — per box: filter accompanying, build fingerprint, increment
    let recorded = 0
    let skippedEmpty = 0
    let skippedNoPackaging = 0

    for (const box of boxRows) {
      if (box.picqer_packaging_id == null || box.picqer_packaging_id <= 0) {
        skippedNoPackaging++
        continue
      }
      const packagingUuid = packagingUuidByPicqerId.get(box.picqer_packaging_id)
      if (!packagingUuid) {
        skippedNoPackaging++
        continue
      }

      const boxProducts = productsByBox.get(box.id) ?? []
      const core: ProductLike[] = []
      for (const p of boxProducts) {
        const attr = attrByProductId.get(p.picqer_product_id)
        if (!isAccompanying(p.productcode, attr)) {
          core.push({
            picqer_product_id: p.picqer_product_id,
            productcode: p.productcode,
            quantity: p.amount,
          })
        }
      }

      if (core.length === 0) {
        skippedEmpty++
        continue
      }

      const fingerprint = buildProductcodeFingerprint(core)
      if (!fingerprint) {
        skippedEmpty++
        continue
      }

      const { error: rpcErr } = await supabase
        .schema('batchmaker')
        .rpc('increment_packing_observation', {
          p_fingerprint: fingerprint,
          p_packaging_id: packagingUuid,
        })

      if (rpcErr) {
        console.error(
          `[recordPackingObservations] RPC failed for box ${box.id}:`,
          rpcErr,
        )
        continue
      }
      recorded++
    }

    if (recorded > 0 || skippedEmpty > 0 || skippedNoPackaging > 0) {
      console.log(
        `[recordPackingObservations] session=${sessionId} recorded=${recorded} skipped_empty=${skippedEmpty} skipped_no_packaging=${skippedNoPackaging}`,
      )
    }
  } catch (err) {
    console.error('[recordPackingObservations] Unexpected error:', err)
  }
}
