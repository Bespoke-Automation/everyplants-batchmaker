// ══════════════════════════════════════════════════════════════
// Floriday Stock Service
// ══════════════════════════════════════════════════════════════
//
// Berekent de huidige voorraad en verwachte voorraad voor Floriday-
// producten op basis van Picqer warehouse 9979 (excl. PPS-locaties)
// en openstaande inkooporders.
//
// Twee modi:
// 1. calcExpectedStock()       — 7-dag rolling window (voor stock UI)
// 2. calcExpectedStockByWeek() — 6 weken vooruit (voor catalog supply sync)
//
// De multi-week functie gebruikt een APARTE Picqer API key
// (PICQER_FLORIDAY_API_KEY) zodat de Floriday sync een eigen
// rate limit budget (500 req/min) heeft.

import { fetchProductsByTag, getProductStock, getPurchaseOrders, getProductExpected } from '@/lib/picqer/client'
import type { PicqerProduct, PicqerProductStock, PicqerExpectedPurchaseOrder } from '@/lib/picqer/types'
import { getNextNWeeks, weekKey, dateToISOWeek } from './utils'

const FLORIDAY_WAREHOUSE_ID = 9979
const PPS_LOCATION_ID = 8467921
// Producten moeten ALLE required tags hebben (EN-logica)
const FLORIDAY_REQUIRED_TAGS = ['Kunstplant', 'Floriday product']
const SYNC_WEEKS = 6  // Aantal weken vooruit voor catalog supply sync

// ─── Dedicated Picqer fetch (eigen API key) ─────────────────
//
// Gebruikt PICQER_FLORIDAY_API_KEY zodat de Floriday sync een
// eigen rate limit budget heeft en de hoofdapp nooit blokkeert.

const PICQER_SUBDOMAIN = process.env.PICQER_SUBDOMAIN!
const FLORIDAY_PICQER_BASE = `https://${PICQER_SUBDOMAIN}.picqer.com/api/v1`
const MAX_RETRIES = 5
const INITIAL_RETRY_DELAY_MS = 2000
const MAX_CONCURRENT = 3

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let fpActiveRequests = 0
const fpQueue: Array<() => void> = []

function fpAcquireSlot(): Promise<void> {
  if (fpActiveRequests < MAX_CONCURRENT) {
    fpActiveRequests++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    fpQueue.push(() => { fpActiveRequests++; resolve() })
  })
}

function fpReleaseSlot(): void {
  fpActiveRequests--
  const next = fpQueue.shift()
  if (next) next()
}

function getFloridayPicqerApiKey(): string {
  const key = process.env.PICQER_FLORIDAY_API_KEY
  if (!key) {
    // Fallback naar standaard key als dedicated key niet ingesteld is
    const fallback = process.env.PICQER_API_KEY
    if (!fallback) throw new Error('Geen PICQER_API_KEY of PICQER_FLORIDAY_API_KEY ingesteld')
    return fallback
  }
  return key
}

async function floridayPicqerFetch(path: string): Promise<Response> {
  await fpAcquireSlot()
  try {
    const apiKey = getFloridayPicqerApiKey()
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const response = await fetch(`${FLORIDAY_PICQER_BASE}${path}`, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
          'User-Agent': 'EveryPlants-FloridaySync/1.0',
          'Content-Type': 'application/json',
        },
      })

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After')
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt)
        console.log(`Floriday Picqer: rate limited, wacht ${delayMs}ms (poging ${attempt + 1}/${MAX_RETRIES})`)
        await sleep(delayMs)
        continue
      }

      return response
    }
    throw new Error('Floriday Picqer: max retries bereikt')
  } finally {
    fpReleaseSlot()
  }
}

async function fpGetProductStock(idproduct: number): Promise<PicqerProductStock> {
  const response = await floridayPicqerFetch(`/products/${idproduct}/stock/${FLORIDAY_WAREHOUSE_ID}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Picqer stock error product ${idproduct}: ${response.status} - ${errorText}`)
  }
  return response.json()
}

async function fpGetProductExpected(idproduct: number): Promise<PicqerExpectedPurchaseOrder[]> {
  const response = await floridayPicqerFetch(`/products/${idproduct}/expected`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Picqer expected error product ${idproduct}: ${response.status} - ${errorText}`)
  }
  return response.json()
}

export interface StockSnapshotItem {
  picqer_product_id: number
  productcode: string
  name: string
  bulk_pick_stock: number       // Huidige stock excl. PPS
  po_qty_this_week: number      // Verwacht via PO's (7 dagen)
  week_stock: number            // Som
  po_details: PoDetail[]
}

export interface PoDetail {
  idpurchaseorder: number
  purchaseorderid?: string
  delivery_date: string
  qty: number
}

// ─── Hulpfuncties ────────────────────────────────────────────

function getThisWeekRange(): { monday: Date; friday: Date } {
  const now = new Date()
  const day = now.getDay() // 0=zo, 1=ma, …, 6=za
  const diffToMonday = day === 0 ? -6 : 1 - day

  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMonday)
  monday.setHours(0, 0, 0, 0)

  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  friday.setHours(23, 59, 59, 999)

  return { monday, friday }
}

function isThisWeek(dateStr: string | null, monday: Date, friday: Date): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d >= monday && d <= friday
}

/**
 * Check of een datum binnen de komende 7 kalenderdagen valt.
 */
function isWithin7Days(dateStr: string | null): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() + 7)
  return d >= now && d <= cutoff
}

// ─── Stap 1: Floriday-producten ophalen ──────────────────────

/**
 * Haal alle Picqer-producten op die ALLE required tags hebben (EN-logica).
 * Haalt op met de eerste tag, filtert daarna in-memory op de rest.
 */
export async function getFloridayProducts(): Promise<PicqerProduct[]> {
  // Haal alle producten op met de eerste tag
  const products = await fetchProductsByTag(FLORIDAY_REQUIRED_TAGS[0])

  // Filter: product moet OOK alle andere required tags hebben
  const otherRequiredTags = FLORIDAY_REQUIRED_TAGS.slice(1)

  if (otherRequiredTags.length === 0) return products

  return products.filter(product => {
    const productTagNames = Object.values(product.tags ?? {}).map(t => t.title)
    return otherRequiredTags.every(tag => productTagNames.includes(tag))
  })
}

// ─── Stap 2: Stock berekenen (excl. PPS) ─────────────────────

/**
 * Haal stock op voor één product in warehouse 9979.
 * Telt alleen locaties mee waarvan type !== 'PPS'.
 */
export async function calcBulkPickStock(idproduct: number): Promise<number> {
  try {
    const stockData = await getProductStock(idproduct, FLORIDAY_WAREHOUSE_ID)
    const totalFreeStock = stockData.freestock ?? 0
    const locations = stockData.locations ?? []

    // Trek PPS locatie stock af van totaal
    const ppsLocation = locations.find(loc => loc.idlocation === PPS_LOCATION_ID)
    const ppsStock = ppsLocation?.free_stock ?? 0

    return Math.max(0, totalFreeStock - ppsStock)
  } catch (error) {
    console.error(`Stock ophalen mislukt voor product ${idproduct}:`, error)
    return 0
  }
}

// ─── Stap 3: PO's deze week (legacy — voor bestaande callers) ──

/**
 * Haal openstaande inkooporders op die deze week binnenkomen (ma–vr).
 * Retourneert een map: idproduct → PoDetail[]
 */
export async function getThisWeekPOs(): Promise<Map<number, PoDetail[]>> {
  const { monday, friday } = getThisWeekRange()
  const allPOs = await getPurchaseOrders('purchased')

  const map = new Map<number, PoDetail[]>()

  for (const po of allPOs) {
    if (!isThisWeek(po.delivery_date, monday, friday)) continue

    for (const product of po.products) {
      const remaining = product.amount - product.amountreceived
      if (remaining <= 0) continue

      const detail: PoDetail = {
        idpurchaseorder: po.idpurchaseorder,
        purchaseorderid: po.purchaseorderid,
        delivery_date: po.delivery_date!,
        qty: remaining,
      }

      const existing = map.get(product.idproduct) ?? []
      existing.push(detail)
      map.set(product.idproduct, existing)
    }
  }

  return map
}

// ─── Stap 3b: Per-product PO's (7-dag rolling window) ────────

/**
 * Bereken verwachte voorraad voor een specifiek product.
 * Gebruikt het per-product /expected endpoint (efficiënter dan alle POs ophalen).
 * Filter: alleen POs binnen 7 kalenderdagen EN voor warehouse 9979.
 */
export async function calcExpectedStock(idproduct: number): Promise<{
  freeStock: number
  expectedFromPOs: number
  totalStock: number
  poDetails: PoDetail[]
}> {
  const [freeStock, expectedPOs] = await Promise.all([
    calcBulkPickStock(idproduct),
    getProductExpected(idproduct),
  ])

  // Filter: alleen POs binnen 7 dagen EN voor warehouse 9979
  const relevantPOs = expectedPOs.filter(po =>
    isWithin7Days(po.delivery_date) && po.idwarehouse === FLORIDAY_WAREHOUSE_ID
  )

  const expectedFromPOs = relevantPOs.reduce((sum, po) => sum + po.amount_to_receive, 0)

  return {
    freeStock,
    expectedFromPOs,
    totalStock: freeStock + expectedFromPOs,
    poDetails: relevantPOs.map(po => ({
      idpurchaseorder: po.idpurchaseorder,
      delivery_date: po.delivery_date!,
      qty: po.amount_to_receive,
    })),
  }
}

// ─── Stap 3c: Multi-week stock per product (catalog supply sync) ──

export interface WeekStockResult {
  year: number
  week: number
  freeStock: number           // Bulk pick stock (zelfde voor elke week)
  cumulativePOs: number       // Cumulatieve PO qty t/m week N+1
  totalStock: number          // freeStock + cumulativePOs
}

/**
 * Bereken verwachte voorraad per ISO week voor de komende 6 weken.
 *
 * CUMULATIEF: voorraad verdwijnt niet na een week.
 * Per week N: freeStock + som van alle PO's die binnenkomen t/m week N+1
 *
 * De +1 look-ahead is omdat PO's die volgende week leveren
 * al beschikbaar zijn voor klantorders in week N.
 *
 * Voorbeeld:
 *   freeStock=100, PO W11=50, PO W12=50, PO W13=50
 *   W10: 100 + PO(≤W11) = 100+50       = 150
 *   W11: 100 + PO(≤W12) = 100+50+50    = 200
 *   W12: 100 + PO(≤W13) = 100+50+50+50 = 250
 *   W13: 100 + PO(≤W14) = 100+50+50+50 = 250
 */
export async function calcExpectedStockByWeek(idproduct: number): Promise<WeekStockResult[]> {
  // 1. Parallel: stock + expected POs (via dedicated key)
  const [stockData, expectedPOs] = await Promise.all([
    fpGetProductStock(idproduct),
    fpGetProductExpected(idproduct),
  ])

  // 2. Bereken free stock (totaal minus PPS locatie)
  const locations = stockData.locations ?? []
  const totalFreeStock = stockData.freestock ?? 0
  const ppsLocation = locations.find(loc => loc.idlocation === PPS_LOCATION_ID)
  const freeStock = Math.max(0, totalFreeStock - (ppsLocation?.free_stock ?? 0))

  // 3. Filter POs: warehouse 9979 + heeft delivery_date
  const relevantPOs = expectedPOs.filter(po =>
    po.idwarehouse === FLORIDAY_WAREHOUSE_ID && po.delivery_date
  )

  // 4. Bucket POs per ISO week
  const poBuckets = new Map<string, number>()
  for (const po of relevantPOs) {
    const { year, week } = dateToISOWeek(po.delivery_date!)
    const key = weekKey(year, week)
    poBuckets.set(key, (poBuckets.get(key) ?? 0) + po.amount_to_receive)
  }

  // 5. Bereken stock per week — CUMULATIEF
  const weeks = getNextNWeeks(SYNC_WEEKS + 1) // +1 voor look-ahead op laatste week
  const results: WeekStockResult[] = []
  let cumulativePOs = 0

  for (let i = 0; i < SYNC_WEEKS; i++) {
    const w = weeks[i]
    const wNext = weeks[i + 1]

    // Tel PO's van deze week op bij cumulatief totaal
    cumulativePOs += poBuckets.get(weekKey(w.year, w.week)) ?? 0
    // Look-ahead: PO's van volgende week meetellen
    const poNextWeek = poBuckets.get(weekKey(wNext.year, wNext.week)) ?? 0

    results.push({
      year: w.year,
      week: w.week,
      freeStock,
      cumulativePOs: cumulativePOs + poNextWeek,
      totalStock: freeStock + cumulativePOs + poNextWeek,
    })
  }

  return results
}

// ─── Stap 4: Volledige snapshot ──────────────────────────────

/**
 * Bouwt een stocksnapshot voor alle Floriday-producten.
 * Combineert huidige stock (excl. PPS) + PO's deze week.
 */
export async function buildStockSnapshot(): Promise<StockSnapshotItem[]> {
  console.log('Stock snapshot starten...')

  const [products, poMap] = await Promise.all([
    getFloridayProducts(),
    getThisWeekPOs(),
  ])

  console.log(`${products.length} Floriday-producten gevonden, stock ophalen...`)

  // Haal stock op per product (3 tegelijk via rate limiter in client)
  const items: StockSnapshotItem[] = await Promise.all(
    products.map(async (product) => {
      const bulkPickStock = await calcBulkPickStock(product.idproduct)
      const poDetails = poMap.get(product.idproduct) ?? []
      const poQtyThisWeek = poDetails.reduce((sum, p) => sum + p.qty, 0)

      return {
        picqer_product_id: product.idproduct,
        productcode: product.productcode,
        name: product.name,
        bulk_pick_stock: bulkPickStock,
        po_qty_this_week: poQtyThisWeek,
        week_stock: bulkPickStock + poQtyThisWeek,
        po_details: poDetails,
      }
    })
  )

  console.log(`Stock snapshot klaar: ${items.length} producten`)
  return items
}
