import { TransformedOrder } from './order'

export interface SingleOrderProduct {
  idproduct: number
  productcode: string
  name: string
}

export interface SingleOrderWithProduct extends TransformedOrder {
  plantProduct: SingleOrderProduct
}

export interface ProductGroup {
  productId: number
  productCode: string
  productName: string
  orders: SingleOrderWithProduct[]
  totalCount: number
  retailerBreakdown: Record<string, number>
  isSelected?: boolean
}

export interface SingleOrdersResponse {
  groups: ProductGroup[]
  totalSingleOrders: number
  metadata: {
    retailers: string[]
    tags: string[]
    countries: string[]
    leverdagen: string[]
  }
  fetchedAt: string
}
