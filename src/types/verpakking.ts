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
  warning?: string
  sessionCompleted?: boolean
  outcome?: string
  deviationType?: string
}

// Ship-all progress for the ShipmentProgress component
export interface ShipAllProgress {
  totalBoxes: number
  currentBoxIndex: number
  boxes: BoxShipmentStatus[]
  isComplete: boolean
  combinedPdfUrl?: string
}

// Local tag (synced from Picqer)
export interface LocalTag {
  id: string
  idtag: number
  title: string
  color: string | null
  textColor: string | null
  inherit: boolean
  tagType: 'packaging' | 'plantura' | 'other'
  isActive: boolean
  lastSyncedAt: string
}

// Local packaging (synced from Picqer)
export interface LocalPackaging {
  id: string
  idpackaging: number
  name: string
  barcode: string | null
  length: number | null
  width: number | null
  height: number | null
  maxWeight: number | null
  boxCategory: string | null
  specificityScore: number
  handlingCost: number
  materialCost: number
  useInAutoAdvice: boolean
  active: boolean
  lastSyncedAt: string
}

// Tag to packaging mapping
export interface TagPackagingMapping {
  id: string
  tagTitle: string
  picqerPackagingId: number
  packagingName: string
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

// ── Batch types ──────────────────────────────────────────────────────────────

// Product within a batch (aggregated across all picklists)
export interface BatchProduct {
  idproduct: number
  productcode: string
  name: string
  image: string | null
  stockLocation: string | null
  amount: number
  amountPicked: number
}

// Queue item (batch in the batch queue view)
export interface QueueBatch {
  idpicklistBatch: number
  batchDisplayId: string
  type: 'singles' | 'normal'
  status: string
  totalProducts: number
  totalPicklists: number
  createdAt: string
  // Picqer assigned user (from picking phase)
  picqerAssignedTo: string | null
  // Comment count from Picqer
  totalComments: number
  // Enriched from Supabase:
  isClaimed: boolean
  claimedByName?: string
  batchSessionId?: string  // If already claimed by current worker
}

// Batch claim result
export interface BatchClaimResult {
  success: boolean
  batchSessionId?: string
  error?: string
}

// Batch session detail (used in BatchOverview)
export interface BatchSessionDetail {
  id: string
  batchId: number
  batchDisplayId: string
  totalPicklists: number
  completedPicklists: number
  totalProducts: number
  batchType: 'singles' | 'normal'
  status: string
  assignedTo: number
  assignedToName: string
  picklists: BatchPicklistItem[]
  products: BatchProduct[]
}

// Picklist item within a batch (for BatchOverview)
export interface BatchPicklistItem {
  idpicklist: number
  picklistid: string
  alias: string | null
  deliveryname: string
  reference: string | null
  totalproducts: number
  status: string  // Picqer status
  hasNotes: boolean
  hasCustomerRemarks: boolean
  customerRemarks: string | null
  sessionId?: string  // If a packing session exists
  sessionStatus?: string  // Status of the packing session
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
