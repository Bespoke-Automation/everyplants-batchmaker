import { NextResponse } from 'next/server'
import { getBackorders, getPurchaseOrders, getProductFull, getSuppliers } from '@/lib/picqer/client'

export const dynamic = 'force-dynamic'

export interface BestellijstRow {
  idproduct: number
  productcode: string
  name: string
  productcode_supplier: string | null
  supplier_name: string | null
  backorder_amount: number
  freestock: number
  purchased_incoming: number
  demand_7d: number
  demand_14d: number
  demand_28d: number
  nog_te_bestellen: number
}

export async function GET() {
  try {
    const now = new Date()

    // Fetch backorders, purchase orders, and suppliers in parallel
    const [backorders, purchaseOrders, suppliers] = await Promise.all([
      getBackorders(),
      getPurchaseOrders('purchased'),
      getSuppliers(),
    ])

    // Build supplier lookup map
    const supplierMap = new Map<number, string>()
    for (const s of suppliers) {
      supplierMap.set(s.idsupplier, s.name)
    }

    // 1. Group backorders by product
    //    Skip composition parents (has_parts=true) — their parts show up as separate backorders
    //    Skip fully available backorders (amount_available >= amount) — no shortage
    //    Only count the shortage (amount - amount_available), not the full backorder
    const backorderMap = new Map<number, number>()
    for (const bo of backorders) {
      if (bo.has_parts) continue
      if (bo.amount_available >= bo.amount) continue
      const shortage = bo.amount - bo.amount_available
      backorderMap.set(bo.idproduct, (backorderMap.get(bo.idproduct) || 0) + shortage)
    }

    if (backorderMap.size === 0) {
      return NextResponse.json({ data: [], suppliers: [] })
    }

    // 2. Build purchased incoming map from purchase orders
    const purchasedMap = new Map<number, number>()
    for (const po of purchaseOrders) {
      for (const product of po.products) {
        const incoming = product.amount - product.amountreceived
        if (incoming > 0) {
          purchasedMap.set(product.idproduct, (purchasedMap.get(product.idproduct) || 0) + incoming)
        }
      }
    }

    // 3. Fetch product details in batches of 5
    const productIds = Array.from(backorderMap.keys())
    const productDetailsMap = new Map<number, {
      productcode: string
      name: string
      freestock: number
      pick_per_day: number
      type: string
      productcode_supplier: string | null
      idsupplier: number | null
    }>()

    for (let i = 0; i < productIds.length; i += 5) {
      const batch = productIds.slice(i, i + 5)
      const results = await Promise.all(
        batch.map(async (idproduct) => {
          try {
            const product = await getProductFull(idproduct)
            const freestock = product.stock
              ? product.stock.reduce((sum, s) => sum + s.freestock, 0)
              : 0
            return {
              idproduct,
              productcode: product.productcode,
              name: product.name,
              freestock,
              pick_per_day: product.analysis_pick_amount_per_day || 0,
              type: product.type || 'normal',
              productcode_supplier: product.productcode_supplier || null,
              idsupplier: product.idsupplier || null,
            }
          } catch {
            return {
              idproduct,
              productcode: String(idproduct),
              name: 'Onbekend product',
              freestock: 0,
              pick_per_day: 0,
              type: 'normal',
              productcode_supplier: null,
              idsupplier: null,
            }
          }
        })
      )
      for (const r of results) {
        productDetailsMap.set(r.idproduct, r)
      }
    }

    // 4. Combine into final rows
    //    Skip composition products and non-plant items (packaging/supplies with very high stock)
    const rows: BestellijstRow[] = []
    const usedSuppliers = new Set<string>()

    for (const [idproduct, totalBackorder] of backorderMap) {
      const details = productDetailsMap.get(idproduct)!

      // Skip virtual compositions — their parts show up as separate backorders
      if (details.type.includes('composition')) continue

      // Skip non-plant items (packaging, flyers, etc.) — identified by very high freestock
      if (details.freestock > 10000) continue

      const purchased = purchasedMap.get(idproduct) || 0
      const nogTeBestellen = Math.max(0, totalBackorder - purchased)
      const supplierName = details.idsupplier ? (supplierMap.get(details.idsupplier) || null) : null

      if (supplierName) usedSuppliers.add(supplierName)

      // Demand estimate based on Picqer's analysis_pick_amount_per_day (28-day average)
      const ppd = details.pick_per_day
      rows.push({
        idproduct,
        productcode: details.productcode,
        name: details.name,
        productcode_supplier: details.productcode_supplier,
        supplier_name: supplierName,
        backorder_amount: totalBackorder,
        freestock: details.freestock,
        purchased_incoming: purchased,
        demand_7d: Math.round(ppd * 7),
        demand_14d: Math.round(ppd * 14),
        demand_28d: Math.round(ppd * 28),
        nog_te_bestellen: nogTeBestellen,
      })
    }

    // Sort by nog_te_bestellen descending
    rows.sort((a, b) => b.nog_te_bestellen - a.nog_te_bestellen)

    return NextResponse.json({
      data: rows,
      suppliers: Array.from(usedSuppliers).sort(),
      meta: {
        total_products: rows.length,
        total_backorder_items: backorders.length,
        fetched_at: now.toISOString(),
        picqer_base_url: `https://${process.env.PICQER_SUBDOMAIN}.picqer.com`,
      },
    })
  } catch (error) {
    console.error('Bestellijst API error:', error)
    return NextResponse.json(
      { error: 'Fout bij ophalen bestellijst', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
