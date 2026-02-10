// Types voor de Verpakkingsmodule

export interface PicklistProduct {
  id: string
  productCode: string
  name: string
  amount: number
  amountPicked: number
  weight: number // in grams
  imageUrl: string | null
  location: string // warehouse location like "A.6", "Bulk"
  assignedBoxId: string | null
}

export interface PackagingType {
  id: string
  name: string
  length: number // cm
  width: number // cm
  height: number // cm
  maxWeight: number // grams
  imageUrl: string
  barcode: string | null
}

export interface Box {
  id: string
  packagingType: PackagingType
  products: PicklistProduct[]
  isClosed: boolean
  shipmentCreated: boolean
  shipmentId: string | null
}

export interface Picklist {
  id: string
  picklistNumber: string
  orderId: string
  orderReference: string
  status: 'open' | 'processing' | 'completed'
  products: PicklistProduct[]
  deliveryAddress: DeliveryAddress
  retailerName: string
  retailerOrderNumber: string | null
  tags: string[]
  shippingProfile: ShippingProfile | null
  totalWeight: number
  created: string
}

export interface DeliveryAddress {
  name: string
  company: string | null
  street: string
  postalCode: string
  city: string
  country: string
  countryCode: string
}

export interface ShippingProfile {
  id: number
  name: string
  carrier: string
}

export interface ShipmentData {
  boxId: string
  packagingId: string
  weight: number
  shippingProfileId: number
}

// Worker (from Picqer Users API)
export interface Worker {
  iduser: number
  firstname: string
  lastname: string
  fullName: string // computed: firstname + ' ' + lastname
}

// Packing Session (mirrors Supabase table but for client-side use)
export interface PackingSessionStatus {
  type: 'assigned' | 'packing' | 'shipping' | 'completed' | 'failed'
}

// Box shipment status for UI progress tracking
export interface BoxShipmentStatus {
  boxId: string
  status: 'pending' | 'shipping' | 'shipped' | 'fetching_label' | 'labeled' | 'error'
  trackingCode?: string
  labelUrl?: string
  error?: string
}

// Ship-all progress for the ShipmentProgress component
export interface ShipAllProgress {
  totalBoxes: number
  currentBoxIndex: number
  boxes: BoxShipmentStatus[]
  isComplete: boolean
  combinedPdfUrl?: string
}

// Tag to packaging mapping
export interface TagPackagingMapping {
  id: string
  tagTitle: string
  picqerPackagingId: number
  packagingName: string
  priority: number
  isActive: boolean
}

// Queue item (picklist in the queue view)
export interface QueuePicklist {
  idpicklist: number
  picklistid: string
  idorder: number
  deliveryname: string
  deliverycountry: string
  totalproducts: number
  totalpicked: number
  status: string
  tags: string[]
  urgent: boolean
  preferred_delivery_date: string | null
  created: string
  // Enriched fields
  isClaimed: boolean
  claimedByName?: string
}

// Claim result
export interface ClaimResult {
  success: boolean
  sessionId?: string
  error?: string
}

// Ship box request/response
export interface ShipBoxRequest {
  boxId: string
  shippingProviderId: number
  packagingId?: number | null
}

export interface ShipBoxResponse {
  success: boolean
  shipmentId?: number
  trackingCode?: string
  labelUrl?: string
  error?: string
}
