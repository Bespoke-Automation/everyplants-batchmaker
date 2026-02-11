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
  created: string
  updated: string
}

export interface CreateShipmentResult {
  success: boolean
  shipment?: PicqerShipment
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
