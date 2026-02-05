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
