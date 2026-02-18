// ══════════════════════════════════════════════════════════════
// Floriday Stock Service
// ══════════════════════════════════════════════════════════════
//
// Berekent de huidige voorraad en weekvoorraad voor Floriday-
// producten op basis van Picqer warehouse 9979 (excl. PPS-locaties)
// en openstaande inkooporders die deze week binnenkomen.

import { fetchProductsByTag, getProductStock, getPurchaseOrders } from '@/lib/picqer/client'
import type { PicqerProduct } from '@/lib/picqer/types'

const FLORIDAY_WAREHOUSE_ID = 9979
const FLORIDAY_TAGS = ['floriday', 'floriday product']

export interface StockSnapshotItem {
  picqer_product_id: number
  productcode: string
  name: string
  bulk_pick_stock: number       // Huidige stock excl. PPS
  po_qty_this_week: number      // Verwacht via PO's (ma–vr)
  week_stock: number            // Som
  po_details: PoDetail[]
}

export interface PoDetail {
  idpurchaseorder: number
  purchaseorderid: string
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

// ─── Stap 1: Floriday-producten ophalen ──────────────────────

/**
 * Haal alle Picqer-producten op met tag "floriday" of "floriday product".
 * Dedupliceer op idproduct.
 */
export async function getFloridayProducts(): Promise<PicqerProduct[]> {
  const results = await Promise.all(
    FLORIDAY_TAGS.map(tag => fetchProductsByTag(tag))
  )

  const seen = new Set<number>()
  const deduped: PicqerProduct[] = []

  for (const batch of results) {
    for (const product of batch) {
      if (!seen.has(product.idproduct)) {
        seen.add(product.idproduct)
        deduped.push(product)
      }
    }
  }

  return deduped
}

// ─── Stap 2: Stock berekenen (excl. PPS) ─────────────────────

/**
 * Haal stock op voor één product in warehouse 9979.
 * Telt alleen locaties mee waarvan type !== 'PPS'.
 */
export async function calcBulkPickStock(idproduct: number): Promise<number> {
  try {
    const stockData = await getProductStock(idproduct, FLORIDAY_WAREHOUSE_ID)
    const locations = stockData.locations ?? []

    return locations
      .filter(loc => loc.type?.toUpperCase() !== 'PPS')
      .reduce((sum, loc) => sum + (loc.stock ?? 0), 0)
  } catch (error) {
    console.error(`Stock ophalen mislukt voor product ${idproduct}:`, error)
    return 0
  }
}

// ─── Stap 3: PO's deze week ──────────────────────────────────

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
