/**
 * Demo runner voor simple-advice-poc.ts
 *
 * Simuleert packing_observations door ze on-the-fly te aggregeren uit
 * packing_session_boxes (laatste 90 dagen, completed). Geen DDL, geen
 * productie-impact.
 *
 * Doel: laat zien wat de nieuwe engine zou adviseren voor de twee
 * gemelde picklists, en vergelijk met het huidige advies.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'batchmaker' } },
)

// Aligned met batchmaker.engine_settings:
//   promotion_threshold = 3   (vanaf 3 observaties is een patroon bruikbaar)
//   invalidation_override_ratio = 0.5 → onze MIN_SHARE wordt 1 - 0.5 = 0.50
// We houden de share-drempel iets strakker dan invalidation om "wisselende
// dominantie" te vermijden, maar conform bestaande conventie.
const MIN_SAMPLES = 3
const MIN_SHARE = 0.50

// ── 1. Build fingerprint ───────────────────────────────────────────
function buildFingerprint(products) {
  const byCode = new Map()
  for (const p of products) {
    byCode.set(p.productcode, (byCode.get(p.productcode) ?? 0) + p.quantity)
  }
  return [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, q]) => `${c}:${q}`).join('|')
}

// Identificeer "begeleidings"-producten die geen rol spelen in dozenkeuze.
// Identieke criteria als de huidige engine (packagingEngine.ts:231-262):
//   - product_type = 'Accessoire'
//   - product_type = 'Onbekend' + classification_status = 'missing_data'  (vangt o.a. Flyer)
//   - korte numerieke codes (1-3 digits) zonder product_attributes row
//   - hardcoded logistics codes (Platen, karren)
const NON_SHIPPABLE_LOGISTICS = new Set(['100000011', '100000012', '100000013'])

async function loadAccompanyingProductCodes() {
  const accompanying = new Set()
  // Vooraf: NON_SHIPPABLE_LOGISTICS altijd
  for (const c of NON_SHIPPABLE_LOGISTICS) accompanying.add(c)

  let from = 0
  while (true) {
    const { data, error } = await db
      .from('product_attributes')
      .select('productcode, product_type, classification_status')
      .range(from, from + 999)
    if (error) throw error
    for (const r of data) {
      const type = (r.product_type ?? '').toLowerCase()
      if (type === 'accessoire') accompanying.add(r.productcode)
      else if (type === 'onbekend' && r.classification_status === 'missing_data') accompanying.add(r.productcode)
    }
    if (data.length < 1000) break
    from += 1000
  }
  return accompanying
}

function splitProducts(products, accompanyingSet) {
  const core = [], accompanying = []
  for (const p of products) {
    const isShortNumeric = /^[0-9]{1,3}$/.test(p.productcode)   // ook geldig als product_attributes ontbreekt
    if (accompanyingSet.has(p.productcode) || isShortNumeric) accompanying.push(p.productcode)
    else core.push(p)
  }
  return { core, accompanying }
}

// ── 2. In-memory observations uit voltooide sessies ───────────────
async function buildObservations(targetProductcodes, accompanyingSet) {
  console.log(`  Building observations for productcodes: ${targetProductcodes.join(', ')}`)

  // Step A: find boxes that contain ANY target productcode
  const { data: targetProductRows, error: eA } = await db
    .from('packing_session_products')
    .select('box_id, productcode')
    .in('productcode', targetProductcodes)
  if (eA) throw eA
  const candidateBoxIds = [...new Set(targetProductRows.map(r => r.box_id))]
  console.log(`  Boxes containing any target productcode: ${candidateBoxIds.length}`)

  // Step B: full product manifest for those boxes (to compute fingerprint correctly)
  const allProducts = []
  for (let i = 0; i < candidateBoxIds.length; i += 200) {
    const slice = candidateBoxIds.slice(i, i + 200)
    const { data, error } = await db
      .from('packing_session_products')
      .select('box_id, picqer_product_id, productcode, amount')
      .in('box_id', slice)
    if (error) throw error
    allProducts.push(...data)
  }

  // Step C: load those boxes
  const allBoxes = []
  for (let i = 0; i < candidateBoxIds.length; i += 200) {
    const slice = candidateBoxIds.slice(i, i + 200)
    const { data, error } = await db
      .from('packing_session_boxes')
      .select('id, session_id, picqer_packaging_id, packaging_name')
      .in('id', slice)
    if (error) throw error
    allBoxes.push(...data)
  }
  console.log(`  Loaded ${allBoxes.length} boxes with ${allProducts.length} product rows`)

  // Step D: load sessions (only completed)
  const sessionIds = [...new Set(allBoxes.map(b => b.session_id))]
  const sessions = []
  for (let i = 0; i < sessionIds.length; i += 200) {
    const slice = sessionIds.slice(i, i + 200)
    const { data, error } = await db
      .from('packing_sessions')
      .select('id, picklist_id, order_id, status, completed_at')
      .in('id', slice)
      .eq('status', 'completed')
    if (error) throw error
    sessions.push(...data)
  }
  console.log(`  Completed sessions: ${sessions.length}`)

  // Map box → products
  const productsByBox = new Map()
  for (const p of allProducts) {
    if (!productsByBox.has(p.box_id)) productsByBox.set(p.box_id, [])
    productsByBox.get(p.box_id).push(p)
  }
  // Map session → boxes
  const boxesBySession = new Map()
  for (const b of allBoxes) {
    if (!boxesBySession.has(b.session_id)) boxesBySession.set(b.session_id, [])
    boxesBySession.get(b.session_id).push(b)
  }

  // Resolve packaging_id (uuid) from picqer_packaging_id
  const allPicqerIds = [...new Set(allBoxes.map(b => b.picqer_packaging_id).filter(Boolean))]
  const { data: pkgs } = await db
    .from('packagings')
    .select('id, idpackaging, name, facturatie_box_sku')
    .in('idpackaging', allPicqerIds)
  const pkgByPicqerId = new Map(pkgs.map(p => [p.idpackaging, p]))

  // Build observation map: (fingerprint, packaging_id) -> count
  // Land-onafhankelijk: workers pakken dezelfde productset overal hetzelfde in.
  const observations = new Map()
  let single = 0, multi = 0
  for (const session of sessions) {
    const boxes = boxesBySession.get(session.id) ?? []
    if (boxes.length !== 1) { multi++; continue }   // POC focust op single-box
    single++

    const box = boxes[0]
    const products = productsByBox.get(box.id) ?? []
    if (products.length === 0) continue

    // Filter accompanying (flyers, giftcards) eruit vóór fingerprint
    const coreProducts = products.filter(p => {
      if (accompanyingSet.has(p.productcode)) return false
      if (/^[0-9]{1,3}$/.test(p.productcode)) return false   // korte numerieke codes (Flyer "1")
      return true
    })
    if (coreProducts.length === 0) continue

    const fp = buildFingerprint(coreProducts.map(p => ({ productcode: p.productcode, quantity: p.amount })))
    const pkg = pkgByPicqerId.get(box.picqer_packaging_id)
    if (!pkg) continue

    const key = `${fp}|${pkg.id}`
    observations.set(key, (observations.get(key) ?? 0) + 1)
  }
  console.log(`  Single-box sessions: ${single}, multi-box (skipped for POC): ${multi}`)
  console.log(`  Distinct (fingerprint, packaging) observations: ${observations.size}`)

  return { observations, pkgByPicqerId, allPackagings: pkgs }
}

// ── 3. Observation match (LAND-ONAFHANKELIJK) ──────────────────────
function findDominantObservation(observations, fingerprint, allPackagings) {
  const matching = []
  for (const [key, count] of observations) {
    const lastBar = key.lastIndexOf('|')
    const fp = key.substring(0, lastBar)
    const pkgId = key.substring(lastBar + 1)
    if (fp === fingerprint) matching.push({ pkgId, count })
  }
  if (matching.length === 0) return { hit: null, breakdown: [] }

  matching.sort((a, b) => b.count - a.count)
  const total = matching.reduce((s, m) => s + m.count, 0)
  const breakdown = matching.map(m => {
    const pkg = allPackagings.find(p => p.id === m.pkgId)
    return { pkg: pkg?.name ?? '?', count: m.count, share: m.count / total }
  })

  if (total < MIN_SAMPLES) return { hit: null, breakdown, reason: `slechts ${total} samples (< ${MIN_SAMPLES})` }
  const top = matching[0]
  const share = top.count / total
  if (share < MIN_SHARE) return { hit: null, breakdown, reason: `dominantie ${(share*100).toFixed(0)}% (< ${MIN_SHARE*100}%)` }

  const pkg = allPackagings.find(p => p.id === top.pkgId)
  return { hit: { pkg, count: top.count, total, share }, breakdown }
}

// ── 4. Default-packaging fallback (alleen bij single-SKU order) ────
// Gebruikt de bestaande product_attributes.default_packaging_id kolom.
// Komt pas in beeld als stap 1 (observation) niks oplevert.
async function findDefaultPackaging(coreProducts) {
  if (coreProducts.length === 0) return { hit: null, reason: 'geen core-producten' }

  const uniqueCodes = new Set(coreProducts.map(p => p.productcode))
  if (uniqueCodes.size !== 1) {
    return { hit: null, reason: `multi-product order (${uniqueCodes.size} unieke SKUs) — default werkt alleen voor single-SKU` }
  }

  const code = coreProducts[0].productcode
  const { data: attr } = await db
    .from('product_attributes')
    .select('productcode, default_packaging_id, packagings(id, name, facturatie_box_sku, active)')
    .eq('productcode', code)
    .maybeSingle()

  if (!attr?.default_packaging_id) return { hit: null, reason: `product ${code} heeft geen default_packaging_id` }
  if (!attr.packagings?.active) return { hit: null, reason: `default packaging is inactief` }

  return { hit: attr.packagings }
}

// ── 5. Run ──────────────────────────────────────────────────────────
async function run() {
  console.log('Loading "accompanying" productcodes (shipping_unit_id IS NULL)...')
  const accompanyingSet = await loadAccompanyingProductCodes()
  console.log(`  Found ${accompanyingSet.size} accompanying products (flyers, kaartjes, giftcards, inserts, etc.)`)

  const cases = [
    {
      name: 'picklist 176635762',
      picklistId: 176635762,
      products: [{ productcode: '333014721', quantity: 1 }],
      country: 'DE',
    },
    {
      name: 'picklist 176714126',
      picklistId: 176714126,
      products: [{ productcode: '215017366', quantity: 1 }],
      country: 'DE',
    },
    // Extra case: realistische order met flyer erbij. Zelfde fingerprint moet eruit komen.
    {
      name: 'picklist 176714126 + flyer (productcode 1)',
      picklistId: 176714126,
      products: [
        { productcode: '215017366', quantity: 1 },
        { productcode: '1', quantity: 1 },
      ],
      country: 'DE',
    },
  ]
  const targetCodes = [...new Set(cases.flatMap(c => c.products.map(p => p.productcode)))]
  const { observations, allPackagings } = await buildObservations(targetCodes, accompanyingSet)

  for (const c of cases) {
    const { core, accompanying } = splitProducts(c.products, accompanyingSet)
    const fp = buildFingerprint(core)
    console.log(`\n${'═'.repeat(72)}`)
    console.log(`▶ ${c.name}`)
    console.log(`  input productcodes: ${c.products.map(p => `${p.productcode}×${p.quantity}`).join(', ')}`)
    console.log(`  → core (advice-relevant): ${core.map(p => `${p.productcode}×${p.quantity}`).join(', ') || '(none)'}`)
    console.log(`  → accompanying (worker pakt mee, geen invloed): ${accompanying.length ? accompanying.join(', ') : '(none)'}`)
    console.log(`  fingerprint: ${fp}`)
    console.log(`  country: ${c.country}  (land-onafhankelijk in deze engine)`)

    // Current advice (live)
    const { data: cur } = await db
      .from('packaging_advice')
      .select('advice_source, confidence, advice_boxes')
      .eq('picklist_id', c.picklistId)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    console.log(`\n  CURRENT engine → ${cur?.advice_boxes?.[0]?.packaging_name ?? '(none)'}`)
    console.log(`     source=${cur?.advice_source}, confidence=${cur?.confidence}`)

    // Step 1: observation
    const obs = findDominantObservation(observations, fp, allPackagings)
    console.log(`\n  STEP 1 — observation match (land-onafhankelijk)`)
    if (obs.breakdown.length === 0) {
      console.log(`     no observations for this fingerprint`)
    } else {
      console.log(`     historical packing distribution (${obs.breakdown.reduce((s, b) => s + b.count, 0)} samples):`)
      for (const b of obs.breakdown.slice(0, 5)) {
        console.log(`       ${b.count.toString().padStart(3)} × ${b.pkg}  (${(b.share * 100).toFixed(0)}%)`)
      }
    }

    if (obs.hit) {
      console.log(`\n  ✅ NEW engine → ${obs.hit.pkg.name}`)
      console.log(`     source=observation, confidence=${obs.hit.share >= 0.85 ? 'high' : 'medium'}`)
      console.log(`     reasoning: ${obs.hit.count}/${obs.hit.total} sessies (${(obs.hit.share*100).toFixed(0)}%)`)
      continue
    }
    if (obs.reason) console.log(`     ↳ no hit: ${obs.reason}`)

    // Step 2: default_packaging_id fallback
    console.log(`\n  STEP 2 — default_packaging_id op product`)
    const def = await findDefaultPackaging(core)
    if (def.hit) {
      console.log(`\n  ✅ NEW engine → ${def.hit.name}`)
      console.log(`     source=default_packaging`)
    } else {
      console.log(`     ↳ ${def.reason}`)
      console.log(`\n  ⚠ NEW engine → no_advice (worker kiest, observation groeit)`)
    }
  }
}

run().catch(e => { console.error(e); process.exit(1) })
