// ══════════════════════════════════════════════════════════════
// Order Mapper: Floriday FulfillmentOrder → Picqer Order
// ══════════════════════════════════════════════════════════════
//
// Transformeert een Floriday FulfillmentOrder + gelinkte SalesOrders
// naar een enkele Picqer CreateOrderInput payload.
//
// Beslissingen:
// - 1 FulfillmentOrder = 1 Picqer Order (meerdere sales orders gecombineerd)
// - Prijs altijd €0
// - Template 9102
// - Load carriers als aparte productregels (1 per carrier)
// - Platen (100000011) op basis van numberOfAdditionalLayers
// - Afleveradres uit FO destination GLN
// - Referentie uit FO.deliveryNoteCodes (zonder letter)
// - Producten geordend per loadCarrier (trolley → producten)

import { supabase } from '@/lib/supabase/client'
import { getFloridayEnv } from '@/lib/floriday/config'
import type { CreateOrderInput, CreateOrderProductInput } from '@/lib/picqer/types'
import { ORDERFIELD_IDS } from '@/lib/picqer/types'
import type { FloridaySalesOrder, FloridayFulfillmentOrder } from '@/lib/floriday/types'
import { getTradeItem, getOrganization } from '@/lib/floriday/client'
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

const PLATES_PRODUCT = { idproduct: 38075137, productcode: '100000011' }

// ─── Types ──────────────────────────────────────────────────

export interface OrderMapResult {
  success: boolean
  payload?: CreateOrderInput
  metadata?: {
    customerName: string
    customerIsNew: boolean
    productNames: string[]
    loadCarrierType: string | null
    numLoadCarriers: number
    numPlates: number
    reference: string
    deliveryDate: string
    salesOrderCount: number
  }
  error?: string
}

// ─── Main Mapper ────────────────────────────────────────────

/**
 * Map a Floriday FulfillmentOrder + its linked SalesOrders to a single Picqer order payload.
 * All sales orders within the FO become product lines in one Picqer order.
 */
export async function mapFulfillmentOrderToPicqer(
  fulfillmentOrder: FloridayFulfillmentOrder,
  salesOrders: FloridaySalesOrder[]
): Promise<OrderMapResult> {
  try {
    if (salesOrders.length === 0) {
      return { success: false, error: 'Geen sales orders gevonden voor dit fulfillment order' }
    }

    // Use the first sales order for customer and delivery info
    const firstSO = salesOrders[0]

    // 1. Resolve customer (same for all SOs in the FO)
    const customer = await resolveCustomer(firstSO.customerOrganizationId)

    // 2. Resolve delivery address from FO destination
    //    Probeer eerst warehouse cache (onze eigen locaties), dan organization API (klantlocaties)
    const deliveryGln = fulfillmentOrder.destination?.location?.gln
    let delivery = deliveryGln ? await resolveWarehouseAddress(deliveryGln) : null
    if (!delivery && fulfillmentOrder.destination?.organizationId) {
      delivery = await resolveOrganizationAddress(
        fulfillmentOrder.destination.organizationId,
        deliveryGln
      )
    }

    // 3. Build product lines — per loadCarrier (trolley + producten)
    const products: CreateOrderProductInput[] = []
    const productNames: string[] = []
    let totalPlates = 0

    // Build salesOrderId → SalesOrder lookup
    const soById = new Map<string, FloridaySalesOrder>()
    for (const so of salesOrders) {
      soById.set(so.salesOrderId, so)
    }

    for (const lc of fulfillmentOrder.loadCarriers || []) {
      // Add load carrier product (1 per carrier)
      const carrierProduct = LOAD_CARRIER_PRODUCTS[lc.loadCarrierType]
      if (carrierProduct) {
        products.push({
          idproduct: carrierProduct.idproduct,
          amount: 1,
          price: 0,
        })
      }

      // Add products for each item on this carrier
      for (const item of lc.loadCarrierItems || []) {
        const so = soById.get(item.salesOrderId)
        if (!so) {
          console.warn(`Sales order ${item.salesOrderId} niet gevonden voor FO ${fulfillmentOrder.fulfillmentOrderId}`)
          continue
        }

        // Resolve product from trade item
        const tradeItem = await getTradeItem(item.tradeItemId)
        const product = await resolveProduct(
          tradeItem.supplierArticleCode,
          tradeItem.tradeItemId,
          tradeItem.tradeItemName?.nl
        )

        if (!product) {
          return {
            success: false,
            error: `Product niet gevonden voor artikelcode "${tradeItem.supplierArticleCode}" (trade item: ${tradeItem.tradeItemName?.nl || item.tradeItemId})`,
          }
        }

        products.push({
          idproduct: product.idproduct,
          amount: item.numberOfPackages,
          price: 0,
        })

        productNames.push(product.name)
      }

      // Count additional layers (plates)
      totalPlates += lc.numberOfAdditionalLayers || 0
    }

    // Add plates product if any
    if (totalPlates > 0) {
      products.push({
        idproduct: PLATES_PRODUCT.idproduct,
        amount: totalPlates,
        price: 0,
      })
    }

    // 4. Build reference from FO-level deliveryNoteCodes
    const reference = (fulfillmentOrder.deliveryNoteCodes || []).join(', ')

    // 5. Build delivery date/time
    const deliveryDateTime = fulfillmentOrder.latestDeliveryDateTime || firstSO.delivery?.latestDeliveryDateTime
    const deliveryDate = deliveryDateTime ? deliveryDateTime.split('T')[0] : undefined

    // 6. Build order fields (Leverdag + Levertijd)
    const orderfields: CreateOrderInput['orderfields'] = deliveryDateTime
      ? [
          { idorderfield: ORDERFIELD_IDS.LEVERDAG, value: extractDeliveryDay(deliveryDateTime) },
          { idorderfield: ORDERFIELD_IDS.LEVERTIJD, value: extractDeliveryTime(deliveryDateTime) },
        ]
      : undefined

    // 7. Collect delivery remarks from all sales orders
    const remarks = salesOrders
      .map(so => so.deliveryRemarks)
      .filter(Boolean)
      .join('; ')

    // 8. Detect load carrier type (for metadata)
    const detectedCarrierType = (fulfillmentOrder.loadCarriers || [])[0]?.loadCarrierType || null
    const numLoadCarriers = (fulfillmentOrder.loadCarriers || []).length

    // 9. Build Picqer payload
    const payload: CreateOrderInput = {
      idcustomer: customer.idcustomer,
      idtemplate: PICQER_TEMPLATE_ID,
      reference: reference || undefined,
      preferred_delivery_date: deliveryDate,
      invoicename: customer.name,
      deliveryname: customer.name,
      deliveryaddress: delivery?.addressLine,
      deliveryzipcode: delivery?.postalCode,
      deliverycity: delivery?.city,
      deliverycountry: delivery?.countryCode,
      language: 'nl',
      customer_remarks: remarks || undefined,
      products,
      orderfields,
    }

    return {
      success: true,
      payload,
      metadata: {
        customerName: customer.name,
        customerIsNew: customer.isNew,
        productNames,
        loadCarrierType: detectedCarrierType,
        numLoadCarriers,
        numPlates: totalPlates,
        reference,
        deliveryDate: deliveryDate || '',
        salesOrderCount: salesOrders.length,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, error: message }
  }
}

// ─── Helpers ────────────────────────────────────────────────

async function resolveWarehouseAddress(gln: string): Promise<{
  name: string
  addressLine: string
  postalCode: string
  city: string
  countryCode: string
} | null> {
  const env = getFloridayEnv()
  const { data } = await supabase
    .schema('floriday')
    .from('warehouse_cache')
    .select('name, address_line, postal_code, city, country_code')
    .eq('gln', gln)
    .eq('environment', env)
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

async function resolveOrganizationAddress(
  organizationId: string,
  gln?: string | null
): Promise<{
  name: string
  addressLine: string
  postalCode: string
  city: string
  countryCode: string
} | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const org: any = await getOrganization(organizationId)
    // Organization API retourneert physicalAddress/mailingAddress op top-level
    const addr = org.physicalAddress || org.mailingAddress

    if (!addr) {
      console.warn(`Geen adres gevonden voor organization ${organizationId}`)
      return null
    }

    return {
      name: org.name || '',
      addressLine: addr.addressLine || '',
      postalCode: addr.postalCode || '',
      city: addr.city || '',
      countryCode: addr.countryCode || 'NL',
    }
  } catch (error) {
    console.warn(`Organization lookup mislukt voor ${organizationId}:`, error)
    return null
  }
}
