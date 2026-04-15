/**
 * Proof-of-Concept: Simple Packaging Advice Engine
 * ─────────────────────────────────────────────────
 *
 * Doel: bewijs dat 11 stappen + 6 bronnen van waarheid kunnen worden
 * vervangen door 3 stappen + 2 bronnen, zonder kwaliteitsverlies.
 *
 * Chain:
 *   [0] Split core / accompanying
 *   [1] Product-fingerprint match via packing_observations (LAND-ONAFHANKELIJK)
 *   [2] product_attributes.default_packaging_id (alleen single-SKU)
 *   [3] no_advice → worker kiest → observation groeit (self-healing)
 *
 * Locatie: planning-artifact, NIET geïmporteerd door de app.
 * Voer apart uit (zie demo-runner onderaan) om te valideren
 * tegen echte orders zonder iets in productie te wijzigen.
 */

import { createClient } from '@supabase/supabase-js'

// ── Types ────────────────────────────────────────────────────────────

export interface OrderProduct {
  picqer_product_id: number
  productcode: string
  quantity: number
}

export interface AdviceBox {
  packaging_id: string
  packaging_name: string
  facturatie_box_sku: string | null
}

export type AdviceSource = 'observation' | 'default_packaging' | 'no_advice'

export interface SimpleAdviceResult {
  source: AdviceSource
  confidence: 'high' | 'medium' | 'low' | 'none'
  box: AdviceBox | null                  // null = worker kiest zelf
  accompanying_products: string[]        // flyers/cards die worker meeverpakt maar geen rol spelen in advies
  reasoning: string
  fingerprint: string                    // alleen "echte" producten (accompanying eruit)
}

// ── De engine: 3 stappen ─────────────────────────────────────────────

export async function simpleAdvice(
  products: OrderProduct[],
  db: ReturnType<typeof createClient>,
): Promise<SimpleAdviceResult> {
  // STAP 0 — Splits "echte" producten van begeleidingsmateriaal (flyers, kaartjes,
  // giftcards, inserts, platen/karren). Criteria 1-op-1 overgenomen uit de bestaande
  // classifyOrderProducts() in packagingEngine.ts:231-262.
  const { core, accompanying } = await splitCoreAndAccompanying(db, products)
  const fingerprint = buildFingerprint(core)

  // STAP 1 — Observation match (LAND-ONAFHANKELIJK)
  // Workers pakken dezelfde productset in elk land op dezelfde manier in.
  // Land-onafhankelijk maximaliseert het aantal samples per fingerprint.
  const observation = await findDominantObservation(db, fingerprint)
  if (observation) {
    return {
      source: 'observation',
      confidence: observation.share >= 0.85 ? 'high' : 'medium',
      box: observation.box,
      accompanying_products: accompanying,
      reasoning: `${observation.count}/${observation.total} sessies (${(observation.share * 100).toFixed(0)}%) gebruikten ${observation.box.packaging_name}`,
      fingerprint,
    }
  }

  // STAP 2 — product_attributes.default_packaging_id (single-SKU only)
  // Fallback wanneer er nog geen (of onvoldoende) observatie bestaat.
  // Fingerprint wint altijd van default: zodra stap 1 hit, overruled het stap 2.
  const def = await findDefaultPackaging(db, core)
  if (def) {
    return {
      source: 'default_packaging',
      confidence: 'low',
      box: def,
      accompanying_products: accompanying,
      reasoning: `Geen observatie nog — fallback op product.default_packaging_id (${def.packaging_name})`,
      fingerprint,
    }
  }

  // STAP 3 — Geen advies → manual
  return {
    source: 'no_advice',
    confidence: 'none',
    box: null,
    accompanying_products: accompanying,
    reasoning: 'Geen observatie en geen product-default — worker kiest handmatig; keuze groeit de observation',
    fingerprint,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Productcode-fingerprint. Identiek aan buildProductFingerprint() uit
 * patternLearner.ts, maar zonder learning/active/invalidated state.
 */
export function buildFingerprint(products: OrderProduct[]): string {
  const byCode = new Map<string, number>()
  for (const p of products) {
    byCode.set(p.productcode, (byCode.get(p.productcode) ?? 0) + p.quantity)
  }
  return Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, qty]) => `${code}:${qty}`)
    .join('|')
}

/**
 * Splitsen van flyers/kaartjes/giftcards/inserts/logistieke items uit vóór
 * fingerprint- en dozenkeuze. Criteria exact overgenomen uit
 * packagingEngine.ts:231-262 — geen nieuwe classificatie-logica.
 *
 * Accompanying blijft in de output zodat de worker ze nog meeverpakt.
 */
const NON_SHIPPABLE_LOGISTICS = new Set(['100000011', '100000012', '100000013'])

async function splitCoreAndAccompanying(
  db: ReturnType<typeof createClient>,
  products: OrderProduct[],
): Promise<{ core: OrderProduct[]; accompanying: string[] }> {
  const ids = [...new Set(products.map(p => p.picqer_product_id))]
  const { data } = await db
    .schema('batchmaker')
    .from('product_attributes')
    .select('picqer_product_id, productcode, product_type, classification_status')
    .in('picqer_product_id', ids)

  const attrByProductId = new Map<number, { product_type: string | null; classification_status: string | null }>()
  for (const r of data ?? []) {
    attrByProductId.set(r.picqer_product_id, {
      product_type: r.product_type,
      classification_status: r.classification_status,
    })
  }

  const core: OrderProduct[] = []
  const accompanying: string[] = []
  for (const p of products) {
    if (isAccompanying(p.productcode, attrByProductId.get(p.picqer_product_id))) {
      accompanying.push(p.productcode)
    } else {
      core.push(p)
    }
  }
  return { core, accompanying }
}

function isAccompanying(
  productcode: string,
  attr: { product_type: string | null; classification_status: string | null } | undefined,
): boolean {
  const type = attr?.product_type?.toLowerCase()
  if (type === 'accessoire') return true
  if (type === 'onbekend' && attr?.classification_status === 'missing_data') return true
  if (/^[0-9]{1,3}$/.test(productcode)) return true
  if (NON_SHIPPABLE_LOGISTICS.has(productcode)) return true
  return false
}

interface ObservationHit {
  box: AdviceBox
  count: number
  total: number
  share: number
}

/**
 * Eén query, geen status-machine. Workers-feedback is een telling, geen regel.
 *
 * Vereist: tabel `packing_observations`
 *   PRIMARY KEY (fingerprint, packaging_id)
 *   - count int default 1
 *   - last_seen_at timestamptz
 *
 * Land-onafhankelijk: workers pakken dezelfde productset overal hetzelfde in.
 * Dat geeft maximaal samples per fingerprint en voorkomt land-fragmentatie.
 *
 * Backfill vanuit packing_session_boxes is een one-shot SELECT/INSERT.
 */
async function findDominantObservation(
  db: ReturnType<typeof createClient>,
  fingerprint: string,
): Promise<ObservationHit | null> {
  // Aligned met bestaande engine_settings:
  //   promotion_threshold = 3, invalidation_override_ratio = 0.5
  // Drempels zouden uit getEngineSettings() moeten komen — voor POC inline.
  const MIN_SAMPLES = 3
  const MIN_SHARE = 0.50

  const { data } = await db
    .schema('batchmaker')
    .from('packing_observations')
    .select('packaging_id, count, packagings(id, name, facturatie_box_sku)')
    .eq('fingerprint', fingerprint)
    .order('count', { ascending: false })

  if (!data || data.length === 0) return null

  const total = data.reduce((s, r) => s + r.count, 0)
  if (total < MIN_SAMPLES) return null

  const top = data[0]
  const share = top.count / total
  if (share < MIN_SHARE) return null

  const pkg = (top as any).packagings
  if (!pkg) return null

  return {
    box: {
      packaging_id: pkg.id,
      packaging_name: pkg.name,
      facturatie_box_sku: pkg.facturatie_box_sku,
    },
    count: top.count,
    total,
    share,
  }
}

/**
 * Stap 2 fallback: single-SKU order → lees product_attributes.default_packaging_id.
 * Werkt alleen als er exact 1 unieke productcode in de core-set zit. Multi-SKU
 * orders zonder observation gaan direct naar no_advice (eerlijk gedrag).
 */
async function findDefaultPackaging(
  db: ReturnType<typeof createClient>,
  core: OrderProduct[],
): Promise<AdviceBox | null> {
  if (core.length === 0) return null

  const uniqueCodes = new Set(core.map(p => p.productcode))
  if (uniqueCodes.size !== 1) return null

  const { data: attr } = await db
    .schema('batchmaker')
    .from('product_attributes')
    .select('default_packaging_id, packagings(id, name, facturatie_box_sku, active)')
    .eq('productcode', core[0].productcode)
    .maybeSingle()

  if (!attr?.default_packaging_id) return null
  const pkg = (attr as any).packagings
  if (!pkg?.active) return null

  return {
    packaging_id: pkg.id,
    packaging_name: pkg.name,
    facturatie_box_sku: pkg.facturatie_box_sku,
  }
}

// ── Observatie schrijven (na sessie completion) ──────────────────────

/**
 * Roep aan vanuit tryCompleteSession() of een Inngest event.
 * Idempotent — herhaalde aanroep voor dezelfde sessie is veilig
 * mits je session_id-deduplicatie toevoegt (zie risico-doc R4).
 */
export async function recordObservation(
  db: ReturnType<typeof createClient>,
  fingerprint: string,
  packagingId: string,
): Promise<void> {
  await db
    .schema('batchmaker')
    .from('packing_observations')
    .upsert(
      {
        fingerprint,
        packaging_id: packagingId,
        count: 1,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'fingerprint,packaging_id', ignoreDuplicates: false },
    )
  // Bij conflict: count += 1 via een DB function, of via een trigger.
  // Productie-versie gebruikt:
  //   ON CONFLICT (fingerprint, packaging_id)
  //   DO UPDATE SET count = packing_observations.count + 1,
  //                 last_seen_at = excluded.last_seen_at
}

// ── Demo runner ──────────────────────────────────────────────────────
//
// Voor een echte E2E demo: gebruik scripts/run-poc-demo.mjs (simuleert
// packing_observations in-memory uit voltooide sessies).

async function demo() {
  const { config } = await import('dotenv')
  config({ path: '.env.local' })

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const cases: { name: string; products: OrderProduct[] }[] = [
    {
      name: 'picklist 176635762',
      products: [{ picqer_product_id: 35209899, productcode: '333014721', quantity: 1 }],
    },
    {
      name: 'picklist 176714126',
      products: [{ picqer_product_id: 31882464, productcode: '215017366', quantity: 1 }],
    },
  ]

  for (const c of cases) {
    const result = await simpleAdvice(c.products, db)
    console.log(`\n${c.name}`)
    console.log(`  fingerprint: ${result.fingerprint}`)
    console.log(`  source: ${result.source} (${result.confidence})`)
    console.log(`  box: ${result.box?.packaging_name ?? '(geen — manual)'}`)
    console.log(`  reasoning: ${result.reasoning}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch(e => { console.error(e); process.exit(1) })
}
