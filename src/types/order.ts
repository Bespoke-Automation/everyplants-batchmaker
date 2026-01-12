export interface OrderTag {
  title: string
  color: string
  textColor: string
}

export interface TransformedOrder {
  id: string
  reference: string
  retailerName: string
  tagTitles: string[]
  tags: OrderTag[]
  bezorgland: string
  leverdag: string
  picklistId: string
  invoiceName: string
  orderId: string
  idOrder: string
  plantnummer: string | null
  hasPlantnummer: boolean
  retailerOrderNumber: string | null
  idCustomer: string
  idTemplate: string
  idShipping: string
  totalProducts: number
  preferredDeliveryDate: string | null
  created: string
  // New fields for batch creation
  idPicklist: number | null
  picklistStatus: string | null
  isPartOfBatch: boolean
  deliveryPostalCode: string | null
  idShippingProvider: number | null
}
