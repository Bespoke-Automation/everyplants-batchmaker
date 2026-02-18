// ══════════════════════════════════════════════════════════════
// Order Mapper: Floriday SalesOrder → Picqer Order
// ══════════════════════════════════════════════════════════════
//
// Transformeert een Floriday SalesOrder + FulfillmentOrder
// naar een Picqer CreateOrderInput payload.
//
// Beslissingen:
// - 1 SalesOrder = 1 Picqer Order
// - Prijs altijd €0
// - Template 9102
// - Load carrier als apart product (Deense kar / Veiling kar)
// - Afleveradres uit warehouse GLN lookup
// - Referenties uit fulfillment order (deliveryNoteCode + Letter)

import { supabase } from '@/lib/supabase/client'
import type { CreateOrderInput } from '@/lib/picqer/types'
import { ORDERFIELD_IDS } from '@/lib/picqer/types'
import type { FloridaySalesOrder, FloridayFulfillmentOrder } from '@/lib/floriday/types'
import { getTradeItem } from '@/lib/floriday/client'
import { resolveProduct } from './product-resolver'
import { resolveCustomer } from './customer-resolver'

// ─── Constants ──────────────────────────────────────────────

const PICQER_TEMPLATE_ID = 9102

const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function extractDeliveryDay(isoDateTime: string): string {
  return DAYS_EN[new Date(isoDateTime).getDay()]
}

function extractDeliveryTime(isoDateTime: string): string {
  return isoDateTime.match(/T(\d{2}:\d{2})/)?.[1] ?? '06:00'
}

const LOAD_CARRIER_PRODUCTS: Record<string, { idproduct: number; productcode: string }> = {
  DANISH_TROLLEY: { idproduct: 38535312, productcode: '100000012' },
  AUCTION_TROLLEY: { idproduct: 38535557, productcode: '100000013' },
}

// ─── Types ──────────────────────────────────────────────────

export interface OrderMapResult {
  success: boolean
  payload?: CreateOrderInput
  metadata?: {
    customerName: string
    customerIsNew: boolean
    productName: string
    loadCarrierType: string | null
    numLoadCarriers: number
    reference: string
    deliveryDate: string
  }
  error?: string
}

// ─── Main Mapper ────────────────────────────────────────────

/**
 * Map a Floriday SalesOrder + optional FulfillmentOrder to a Picqer order payload.
 */
export async function mapSalesOrderToPicqer(
  salesOrder: FloridaySalesOrder,
  fulfillmentOrder?: FloridayFulfillmentOrder
): Promise<OrderMapResult> {
  try {
    // 1. Resolve product
    const tradeItem = await getTradeItem(salesOrder.tradeItemId)
    const product = await resolveProduct(
      tradeItem.supplierArticleCode,
      tradeItem.tradeItemId,
      tradeItem.tradeItemName?.nl
    )

    if (!product) {
      return {
        success: false,
        error: `Product niet gevonden voor artikelcode "${tradeItem.supplierArticleCode}"`,
      }
    }

    // 2. Resolve customer
    const customer = await resolveCustomer(salesOrder.customerOrganizationId)

    // 3. Resolve delivery address from warehouse GLN
    const deliveryGln = salesOrder.delivery?.location?.gln
    const delivery = deliveryGln ? await resolveWarehouseAddress(deliveryGln) : null

    // 4. Extract fulfillment data (references + carrier count)
    const fulfillmentData = extractFulfillmentData(salesOrder.salesOrderId, fulfillmentOrder)

    // 5. Build product lines
    const products: CreateOrderInput['products'] = [
      {
        idproduct: product.idproduct,
        amount: salesOrder.numberOfPieces,
        price: 0,
      },
    ]

    // Add load carrier product if applicable
    // Use fulfillment's loadCarrierType (e.g. DANISH_TROLLEY) — sales order uses codes like CC
    const loadCarrierType = fulfillmentData.loadCarrierType
    if (loadCarrierType && LOAD_CARRIER_PRODUCTS[loadCarrierType] && fulfillmentData.numLoadCarriers > 0) {
      products.push({
        idproduct: LOAD_CARRIER_PRODUCTS[loadCarrierType].idproduct,
        amount: fulfillmentData.numLoadCarriers,
        price: 0,
      })
    }

    // 6. Build delivery date
    const deliveryDate = salesOrder.delivery?.latestDeliveryDateTime
      ? salesOrder.delivery.latestDeliveryDateTime.split('T')[0]
      : undefined

    // 7. Build order fields (Leverdag + Levertijd)
    const deliveryDateTime = salesOrder.delivery?.latestDeliveryDateTime
    const orderfields: CreateOrderInput['orderfields'] = deliveryDateTime
      ? [
          { idorderfield: ORDERFIELD_IDS.LEVERDAG, value: extractDeliveryDay(deliveryDateTime) },
          { idorderfield: ORDERFIELD_IDS.LEVERTIJD, value: extractDeliveryTime(deliveryDateTime) },
        ]
      : undefined

    // 8. Build Picqer payload
    const payload: CreateOrderInput = {
      idcustomer: customer.idcustomer,
      idtemplate: PICQER_TEMPLATE_ID,
      reference: fulfillmentData.reference || undefined,
      preferred_delivery_date: deliveryDate,
      deliveryname: customer.name,
      deliveryaddress: delivery?.addressLine,
      deliveryzipcode: delivery?.postalCode,
      deliverycity: delivery?.city,
      deliverycountry: delivery?.countryCode,
      language: 'nl',
      customer_remarks: salesOrder.deliveryRemarks || undefined,
      products,
      orderfields,
    }

    return {
      success: true,
      payload,
      metadata: {
        customerName: customer.name,
        customerIsNew: customer.isNew,
        productName: product.name,
        loadCarrierType: loadCarrierType || null,
        numLoadCarriers: fulfillmentData.numLoadCarriers,
        reference: fulfillmentData.reference,
        deliveryDate: deliveryDate || '',
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function extractFulfillmentData(
  salesOrderId: string,
  fulfillmentOrder?: FloridayFulfillmentOrder
): { reference: string; numLoadCarriers: number; loadCarrierType: string | null } {
  if (!fulfillmentOrder) {
    return { reference: '', numLoadCarriers: 0, loadCarrierType: null }
  }

  const refs: string[] = []
  let carrierCount = 0
  let detectedCarrierType: string | null = null

  for (const lc of fulfillmentOrder.loadCarriers || []) {
    // Check if this carrier has items for our sales order
    const relevantItems = lc.loadCarrierItems?.filter(
      item => item.salesOrderId === salesOrderId
    ) || []

    if (relevantItems.length > 0) {
      carrierCount++
      // Capture the load carrier type from the fulfillment (e.g. DANISH_TROLLEY)
      if (!detectedCarrierType && lc.loadCarrierType) {
        detectedCarrierType = lc.loadCarrierType
      }
      // Item-level codes (meest specifiek, bijv. 'F2AC98A' = code + letter)
      const itemCodes: string[] = []
      for (const item of relevantItems) {
        if (item.deliveryNoteCode) {
          const ref = item.deliveryNoteCode + (item.deliveryNoteLetter || '')
          if (ref && !refs.includes(ref)) itemCodes.push(ref)
        }
      }
      if (itemCodes.length > 0) {
        // Item-level codes beschikbaar: gebruik die (meest specifiek)
        refs.push(...itemCodes)
      } else {
        // Geen item-level codes: fallback naar carrier-niveau (bijv. '50000A' voor klokkopen)
        if (lc.documentReference && !refs.includes(lc.documentReference)) {
          refs.push(lc.documentReference)
        }
        for (const code of lc.deliveryNoteCodes || []) {
          if (!refs.includes(code)) refs.push(code)
        }
      }
    }
  }

  return {
    reference: refs.join(', '),
    numLoadCarriers: carrierCount,
    loadCarrierType: detectedCarrierType,
  }
}

async function resolveWarehouseAddress(gln: string): Promise<{
  name: string
  addressLine: string
  postalCode: string
  city: string
  countryCode: string
} | null> {
  const { data } = await supabase
    .schema('floriday')
    .from('warehouse_cache')
    .select('name, address_line, postal_code, city, country_code')
    .eq('gln', gln)
    .single()

  if (!data) {
    console.warn(`Warehouse niet gevonden voor GLN "${gln}"`)
    return null
  }

  return {
    name: data.name,
    addressLine: data.address_line || '',
    postalCode: data.postal_code || '',
    city: data.city || '',
    countryCode: data.country_code || 'NL',
  }
}
