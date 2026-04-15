/**
 * Accompanying / core split — pure helper
 * ────────────────────────────────────────
 *
 * Single source of truth voor: welke productcodes moeten WEL meewegen in het
 * packaging-advies (core), en welke NIET (accompanying — flyers, kaartjes,
 * giftcards, inserts, platen, karren)?
 *
 * Criteria exact overgenomen uit packagingEngine.ts (de oude classifyOrderProducts).
 * Zodra deze helper bestaat, gebruikt packagingEngine.ts hem ook, zodat de
 * classificatie op één plek leeft.
 *
 * Gebruikt door:
 *   - src/lib/engine/packagingEngine.ts (bestaande engine)
 *   - src/lib/verpakking/recordPackingObservations.ts (fase 1)
 *   - scripts/backfill-packing-observations.ts (éénmalige backfill)
 *   - (fase 2+) src/lib/engine/simpleAdvice.ts
 */

// ── Types ────────────────────────────────────────────────────────────

/**
 * Minimale product-input voor het berekenen van een fingerprint.
 * picqer_product_id is optioneel want de backfill leest soms alleen
 * productcode uit packing_session_products.
 */
export interface ProductLike {
  picqer_product_id?: number
  productcode: string
  quantity: number
}

/**
 * Subset van product_attributes die nodig is om isAccompanying() te bepalen.
 * Verplicht minimaal: product_type + classification_status.
 */
export interface AccompanyingAttr {
  product_type: string | null
  classification_status: string | null
}

// ── Constants ────────────────────────────────────────────────────────

/**
 * Non-shippable logistics codes (geen echte handelsartikelen).
 * - 100000011 = Platen
 * - 100000012 = Deense kar
 * - 100000013 = Veilingkar
 *
 * Bron: packagingEngine.ts (NON_SHIPPABLE_CODES).
 */
export const NON_SHIPPABLE_LOGISTICS: readonly string[] = [
  '100000011',
  '100000012',
  '100000013',
] as const

const NON_SHIPPABLE_LOGISTICS_SET = new Set<string>(NON_SHIPPABLE_LOGISTICS)

// ── Core predicate ───────────────────────────────────────────────────

/**
 * True als dit product "accompanying" is en dus GEEN rol speelt in het
 * packaging-advies. De worker pakt ze wel in, maar ze horen niet in de
 * fingerprint.
 *
 * Criteria (identiek aan packagingEngine.ts:231-262):
 *   1. product_type = 'accessoire'                           (bv. Flyer, kaart)
 *   2. product_type = 'onbekend' + classification_status = 'missing_data'
 *   3. productcode matcht /^[0-9]{1,3}$/ ZONDER product_attributes row
 *      (korte numerieke code, bv. Flyer "1"). De `!attr` guard voorkomt
 *      dat een echt product met toevallig korte code wordt weggegooid.
 *   4. productcode is een non-shippable logistics code (100000011/12/13)
 *
 * NB: product_type='Plant' + classification_status='missing_data' is GEEN
 * accompanying — dat zijn ongeclassificeerde echte planten (ops-fix nodig),
 * geen flyers. Die blijven in core.
 */
export function isAccompanying(
  productcode: string,
  attr: AccompanyingAttr | undefined,
): boolean {
  const type = attr?.product_type?.toLowerCase()
  if (type === 'accessoire') return true
  if (type === 'onbekend' && attr?.classification_status === 'missing_data') {
    return true
  }
  if (!attr && /^[0-9]{1,3}$/.test(productcode)) return true
  if (NON_SHIPPABLE_LOGISTICS_SET.has(productcode)) return true
  return false
}

// ── Fingerprint ──────────────────────────────────────────────────────

/**
 * Productcode-fingerprint. Identiek aan buildProductFingerprint() in
 * patternLearner.ts (die blijft bestaan voor de oude engine) maar zonder
 * de null-terugval: lege input levert een lege string op zodat callers
 * zelf kunnen beslissen of ze doorgaan.
 *
 * Format: "productcode:qty|productcode:qty" — alfabetisch gesorteerd op
 * productcode. Geen land, geen shipping-unit-labels.
 *
 * Duplicaten worden opgeteld (zelfde productcode twee keer in de input
 * geeft een enkele entry met som van quantities).
 */
export function buildProductcodeFingerprint(
  products: readonly ProductLike[],
): string {
  if (products.length === 0) return ''

  const byCode = new Map<string, number>()
  for (const p of products) {
    byCode.set(p.productcode, (byCode.get(p.productcode) ?? 0) + p.quantity)
  }

  return Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, qty]) => `${code}:${qty}`)
    .join('|')
}

// ── Convenience: split in één call ───────────────────────────────────

/**
 * Splits producten in core + accompanying op basis van attribute-map.
 * Pure functie — geen DB-calls, caller haalt attributes zelf op.
 *
 * `attrByPicqerId` is optioneel; als een product niet in de map staat,
 * valt isAccompanying() terug op productcode-regels alleen.
 */
export function splitCoreAndAccompanying<T extends ProductLike>(
  products: readonly T[],
  attrByPicqerId: ReadonlyMap<number, AccompanyingAttr>,
): { core: T[]; accompanying: T[] } {
  const core: T[] = []
  const accompanying: T[] = []
  for (const p of products) {
    const attr =
      p.picqer_product_id !== undefined
        ? attrByPicqerId.get(p.picqer_product_id)
        : undefined
    if (isAccompanying(p.productcode, attr)) {
      accompanying.push(p)
    } else {
      core.push(p)
    }
  }
  return { core, accompanying }
}
