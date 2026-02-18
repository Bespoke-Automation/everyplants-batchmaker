// ══════════════════════════════════════════════════════════════
// Floriday Suppliers API v2025v2 — Type Definitions
// ══════════════════════════════════════════════════════════════

// ─── Sync Response Wrapper ───────────────────────────────────
// All /sync/{sequenceNumber} endpoints return this wrapper
export interface FloridaySyncResponse<T> {
  maximumSequenceNumber: number
  results: T[]
}

// ─── Organizations ───────────────────────────────────────────
export interface FloridayOrganization {
  organizationId: string
  name: string
  companyGln?: string
  organizationType: string
  locations?: FloridayLocation[]
}

export interface FloridayLocation {
  locationId: string
  name: string
  gln?: string
  address?: FloridayAddress
}

export interface FloridayAddress {
  addressLine: string
  city: string
  postalCode: string
  countryCode: string // 3-letter ISO (NLD, DEU, BEL, etc.)
  stateOrProvince?: string
}

// ─── Trade Items (Catalog) ───────────────────────────────────
export interface FloridayTradeItem {
  tradeItemId: string
  sellerOrganizationId: string
  supplierArticleCode: string          // Max 13 chars — map naar Picqer productcode
  articleGtin?: string                 // EAN-13 barcode
  vbnProductCode: number               // VBN productcode (verplicht sierteelt)
  tradeItemName: { nl: string }        // Max 120 chars
  characteristics: FloridayCharacteristic[]
  photos: FloridayPhoto[]
  packingConfigurations: FloridayPackingConfiguration[]
  isHiddenInCatalog: boolean
  sequenceNumber: number
  creationDateTime: string
  lastModifiedDateTime: string
  hasInvalidFloricodeData?: boolean
}

export interface FloridayCharacteristic {
  vbnCode: string       // Max 3 chars (bijv. "C01" voor kleur, "P01" voor potmaat)
  vbnValueCode: string  // Max 3 chars
}

export interface FloridayPhoto {
  primary: boolean
  url: string           // https://image.floriday.io/{mediaId}
  type: FloridayPhotoType
  seasonalPeriod?: object
}

export type FloridayPhotoType =
  | 'PIECE'
  | 'TRAY'
  | 'DETAIL'
  | 'RULER'
  | 'WEBSHOPFRIENDLY'
  | 'SCENE'
  | 'SEASON'
  | 'STEM'
  | 'BUNCH'
  | 'CONTAINER'
  | 'CLOCK'

// ─── Packing ─────────────────────────────────────────────────
export interface FloridayPackingConfiguration {
  primary: boolean
  piecesPerPackage: number  // Max 9999
  package: FloridayPackage
  packagesPerLayer: number
  layersPerLoadCarrier: number
  loadCarrier: FloridayLoadCarrier
  isHiddenForDirectSales?: boolean
}

export interface FloridayPackage {
  packageCode: string       // VBN package code
  customPackageId?: string
}

export interface FloridayLoadCarrier {
  loadCarrierType: string   // bijv. 'CC' (container cart)
}

// ─── Supply Lines ────────────────────────────────────────────
export interface FloridaySupplyLine {
  supplyLineId: string
  status: 'AVAILABLE' | 'UNAVAILABLE'
  tradeItemId: string
  batchId?: string
  pricePerPiece: FloridayPrice
  volumePrices?: FloridayVolumePrice[]
  numberOfPieces: number
  orderPeriod: FloridayTradePeriod
  deliveryPeriod?: FloridayTradePeriod
  sequenceNumber: number
}

export interface FloridaySupplyLineCreate {
  supplyLineId: string                        // Zelf genereren (UUID v4)
  batchId: string
  tradeItemId?: string
  pricePerPiece: FloridayPrice
  orderPeriod: FloridayTradePeriod
  deliveryPeriod: FloridayTradePeriod
  includedServices: object[]
  packingConfigurations: FloridayPackingConfigurationInput[]
  allowedCustomerOrganizationIds?: string[]   // Leeg = iedereen
  numberOfPieces?: number
}

export interface FloridayPackingConfigurationInput {
  piecesPerPackage: number
  packageCode: string
  packagesPerLayer: number
  layersPerLoadCarrier: number
  loadCarrierType: string
}

// ─── Batches (Stock) ─────────────────────────────────────────
export interface FloridayBatchCreate {
  batchId: string               // Zelf genereren (UUID v4)
  batchDate: string             // ISO 8601
  tradeItemId: string
  numberOfPieces: number
  packingConfiguration: FloridayPackingConfigurationInput
  warehouseId: string
  batchReference?: string       // Max 50 chars
}

// ─── Sales Orders ────────────────────────────────────────────
export interface FloridaySalesOrder {
  salesOrderId: string
  salesChannelOrderId: string          // Max 13 chars
  customerOrderId?: string             // Max 26 chars
  supplierOrganizationId: string
  customerOrganizationId: string
  tradeItemId: string
  salesChannel: FloridaySalesChannel
  numberOfPieces: number
  packingConfiguration: FloridayPackingConfiguration
  pricePerPiece: FloridayPrice
  delivery: FloridaySalesOrderDelivery
  status: FloridaySalesOrderStatus
  orderDateTime: string
  sequenceNumber: number
  cancellationDeadline?: string
  deliveryRemarks?: string
  batchId?: string
  calculatedFields?: {
    totalPricePerPiece: FloridayPrice
    orderAmount: FloridayPrice
  }
}

export interface FloridaySalesOrderDelivery {
  latestDeliveryDateTime: string
  location: {
    gln?: string
    address?: FloridayAddress
  }
}

export type FloridaySalesOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'COMMITTED'
  | 'UNFULFILLABLE'
  | 'CANCELLED'
  | 'EXPIRED'

export type FloridaySalesChannel =
  | 'FLORIDAY'
  | 'FLORAMONDO'
  | 'FLORIDAY_FX'
  | 'FLORAXCHANGE'
  | 'PLANTION_CLOCK'
  | 'RFH_CLOCK'
  | 'VRM_CLOCK'
  | 'EXTERNAL_INTEGRATION'
  | 'UNKNOWN'

// ─── Shared Types ────────────────────────────────────────────
export interface FloridayPrice {
  value: number
  currency: string  // 'EUR'
}

export interface FloridayVolumePrice {
  minimumQuantity: number
  pricePerPiece: FloridayPrice
}

export interface FloridayTradePeriod {
  startDateTime: string   // ISO 8601
  endDateTime: string     // ISO 8601
}

// ─── Fulfillment Orders ─────────────────────────────────────
export interface FloridayFulfillmentOrder {
  fulfillmentOrderId: string
  latestDeliveryDateTime: string
  supplierOrganizationId: string
  carrierOrganizationId: string
  destination: {
    organizationId: string
    warehouseId: string | null
    location: {
      gln: string | null
      address: FloridayAddress | null
    }
  }
  loadCarriers: FloridayLoadCarrierFull[]
  deliveryNoteCodes: string[]
  status: string
  type: string // e.g. 'DIRECT_SALES'
  sequenceNumber: number
  creationDateTime: string
  lastModifiedDateTime: string
}

export interface FloridayLoadCarrierFull {
  loadCarrierType: string // e.g. 'DANISH_TROLLEY', 'AUCTION_TROLLEY'
  loadCarrierItems: FloridayLoadCarrierItem[]
  documentReference: string | null
  deliveryNoteCodes: string[]
  sortIndex: number
  isReceived: boolean
}

export interface FloridayLoadCarrierItem {
  fulfillmentRequestId: string
  salesOrderId: string
  tradeItemId: string
  numberOfPackages: number
  deliveryNoteCode: string
  deliveryNoteLetter: string
  batchReference: string | null
  deliveryRemarks: string | null
}

// ─── Warehouses ────────────────────────────────────────────
export interface FloridayWarehouse {
  warehouseId: string
  organizationId: string
  name: string
  services: string[] | null // e.g. ['AUCTION', 'EXTERNAL_STOCK']
  location: {
    gln: string
    address: FloridayAddress | null
  }
  sequenceNumber: number
}

// ─── Webhook Events ──────────────────────────────────────────
export type FloridayAggregateType =
  | 'SALESORDER'
  | 'BATCH'
  | 'DELIVERYORDER'
  | 'FULFILLMENTORDER'

export type FloridaySalesOrderEventType =
  | 'ACCEPTED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'COMMITTED'
  | 'PRICE_UPDATED'
  | 'CORRECTED'

export type FloridayBatchEventType =
  | 'CREATED'
  | 'QUANTITY_CHANGED'
  | 'CANCELLED'

export interface FloridayWebhookSubscription {
  callbackUrl: string
}
