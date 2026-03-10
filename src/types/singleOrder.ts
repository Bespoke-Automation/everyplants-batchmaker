import { TransformedOrder } from './order'

export interface CombinationProduct {
  idproduct: number
  productcode: string
  name: string
  amount: number
}

export interface SingleOrderWithProduct extends TransformedOrder {
  combinationProducts: CombinationProduct[]
  combinationFingerprint: string
}

export interface ProductGroup {
  fingerprint: string
  combinationProducts: CombinationProduct[]
  displayName: string
  orders: SingleOrderWithProduct[]
  totalCount: number
  retailerBreakdown: Record<string, number>
  isSelected?: boolean
}

export interface SingleOrdersResponse {
  groups: ProductGroup[]
  totalMatchedOrders: number
  metadata: {
    retailers: string[]
    tags: string[]
    countries: string[]
    leverdagen: string[]
  }
  fetchedAt: string
}
