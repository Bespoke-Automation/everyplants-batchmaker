// Picqer API Response Types

export interface PicqerTag {
  idtag: number
  title: string
  color: string
  inherit: boolean
  textColor: string
}

export interface PicqerOrderfield {
  idorderfield: number
  title: string
  value: string
}

export interface PicqerPicklist {
  idpicklist: number
  picklistid: string
  idorder: number
  idwarehouse: number
  status: 'new' | 'paused' | 'closed' | 'snoozed' | 'cancelled'
  totalproducts: number
  totalpicked: number
  idpicklist_batch: number | null
  created: string
  updated: string
  preferred_delivery_date: string | null
  // Shipping provider profile from order (used for shipment creation)
  idshippingprovider_profile: number | null
  weight: number | null
  // Tags assigned to this picklist (from Picqer API)
  tags?: { idtag: number; title: string; color?: string }[]
}

// Product within an order
export interface PicqerOrderProduct {
  idorder_product: number
  idproduct: number
  idvatgroup: number
  productcode: string
  name: string
  remarks: string | null
  price: number
  amount: number
  amount_cancelled: number
  weight: number
  partof_idorder_product: number | null
  has_parts: boolean
}

export interface PicqerOrder {
  idorder: number
  orderid: string
  reference: string
  status: 'concept' | 'expected' | 'processing' | 'paused' | 'completed' | 'cancelled'
  invoicename: string
  invoicecontactname: string
  deliveryname: string
  deliverycontactname: string
  deliveryaddress: string
  deliverycity: string
  deliverycountry: string
  deliveryzipcode: string | null
  emailaddress: string
  telephone: string
  created: string
  updated: string
  idtemplate: number
  idshippingprovider_profile: number | null
  idcustomer: number | null
  tags: Record<string, PicqerTag>
  orderfields: PicqerOrderfield[]
  picklists: PicqerPicklist[]
  products: PicqerOrderProduct[]
}

// Custom orderfield IDs (from Picqer configuration)
export const ORDERFIELD_IDS = {
  PLANTNUMMER: 3262,
  RETAILER_NAME: 3332,
  RETAILER_ORDER_NUMBER: 3333,
  LEVERDAG: 3507,
  LEVERTIJD: 3506,
} as const

// Tags to exclude from batch creation
export const EXCLUDED_TAGS = [
  'Versturen wanneer niet te koud',
  'Klant gemaild',
  'Versturen wanneer op voorraad',
] as const

// Picklist product (line item within a picklist)
export interface PicqerPicklistProduct {
  idpicklist_product: number
  idproduct: number
  productcode: string
  name: string
  amount: number
  amount_picked: number
  image?: string | null // Enriched from batch products (not in Picqer response)
}

// Extended picklist with products
export interface PicqerPicklistWithProducts extends PicqerPicklist {
  products: PicqerPicklistProduct[]
}

// Product with tags
export interface PicqerProduct {
  idproduct: number
  productcode: string
  name: string
  tags: Record<string, PicqerTag>
}

// Product tag to exclude from plant count (non-plant items like flyers, boxes)
export const EXCLUDED_PRODUCT_TAG = 'Overig'

// Packaging types
export interface PicqerPackaging {
  idpackaging: number
  name: string
  barcode: string | null
  length: number | null
  width: number | null
  height: number | null
  use_in_auto_advice: boolean
  active: boolean
}

// Shipping method types
export interface ShippingMethod {
  idshippingprovider_profile: number
  name: string
  carrier: string
}

// Shipment types

export interface PicqerShipmentParcel {
  idshipment_parcel: number
  idpackaging: number | null
  weight: number | null
  trackingcode: string | null
  tracktraceurl: string | null
  labelurl?: string
  labelurl_pdf?: string
}

export interface PicqerShipment {
  idshipment: number
  idpicklist: number
  provider: string
  providername: string
  public_providername?: string
  profile_name?: string
  carrier_key?: string
  labelurl?: string
  labelurl_pdf?: string
  labelurl_zpl?: string | null
  tracktraceurl?: string
  trackingurl?: string
  trackingcode?: string
  cancelled: boolean
  parcels?: PicqerShipmentParcel[]
  created: string
  updated: string
}

export interface MulticolloParcelInput {
  idpackaging: number
  weight: number // in grams
}

export interface CreateShipmentResult {
  success: boolean
  shipment?: PicqerShipment
  error?: string
}

export interface CancelShipmentResult {
  success: boolean
  error?: string
}

export interface GetLabelResult {
  success: boolean
  labelData?: Buffer
  contentType?: string
  error?: string
}

export interface PicqerUser {
  iduser: number
  username: string
  firstname: string
  lastname: string
  emailaddress: string
  active: boolean
  idpacking_station: number | null
  last_login_at: string | null
  created_at: string
  updated_at: string
}

// Picklist batch (from /picklists/batches endpoint)
export interface PicqerPicklistBatch {
  idpicklist_batch: number
  picklist_batchid: string
  idwarehouse: number
  type: 'singles' | 'normal'
  status: 'open' | 'completed'
  assigned_to: { iduser: number; full_name: string; username: string } | null
  completed_by: { iduser: number; full_name: string; username: string } | null
  total_products: number
  total_picklists: number
  created_at: string
  updated_at: string
  completed_at: string | null
  // Only present in single batch detail (GET /picklists/batches/{id})
  picklists?: PicqerBatchPicklist[]
  products?: PicqerBatchProduct[]
}

// Product-picklist allocation within a batch product
export interface PicqerBatchProductPicklist {
  idpicklist: number
  amount: number
  amount_picked: number
  amount_collected: number
}

// Product within a batch (from batch detail response)
// Note: amounts are nested per-picklist, not top-level
export interface PicqerBatchProduct {
  idproduct: number
  name: string
  productcode: string
  productcode_supplier: string | null
  image: string | null
  stock_location: string | null
  picklists: PicqerBatchProductPicklist[]
}

// Picklist as nested inside a batch detail response
export interface PicqerBatchPicklist {
  idpicklist: number
  picklistid: string
  reference: string | null
  alias: string | null
  status: string
  total_products: number
  delivery_name: string
  has_notes: boolean
  has_customer_remarks: boolean
  customer_remarks: string | null
  created_at: string
}

// Product field (custom field on product)
export interface PicqerProductField {
  idproductfield: number
  title: string
  value: string
}

// Product with full details including custom fields
export interface PicqerProductFull {
  idproduct: number
  productcode: string
  name: string
  price: number
  weight?: number
  length?: number
  width?: number
  height?: number
  type?: string // 'normal' | 'virtual_composition' | 'composition_with_stock' | 'unlimited_stock'
  active: boolean
  productfields?: PicqerProductField[]
  tags?: PicqerTag[]
  created?: string
  updated?: string
}

// Composition part
export interface PicqerCompositionPart {
  idproduct: number
  idproduct_part: number
  amount: number
  productcode_part?: string
  name_part?: string
}

// Customer types
export interface PicqerCustomer {
  idcustomer: number
  name: string
  contactname: string | null
  address: string | null
  address2: string | null
  zipcode: string | null
  city: string | null
  region: string | null
  country: string | null
  emailaddress: string | null
  telephone: string | null
  language: string | null
  created: string
  updated: string
}

export interface CreateOrderInput {
  idcustomer: number
  idtemplate: number
  reference?: string
  preferred_delivery_date?: string
  deliveryname?: string
  deliveryaddress?: string
  deliveryzipcode?: string
  deliverycity?: string
  deliverycountry?: string
  language?: string
  customer_remarks?: string
  products: CreateOrderProductInput[]
  orderfields?: Array<{ idorderfield: number; value: string }>
}

export interface CreateOrderProductInput {
  idproduct: number
  amount: number
  price: number
}

// Result for batch creation with shipments
export interface SingleOrderBatchResult {
  success: boolean
  batchId: string
  totalOrders: number
  successfulShipments: number
  failedShipments: number
  errors: Array<{
    orderId: number
    orderReference: string
    error: string
  }>
  combinedPdfUrl?: string
}
