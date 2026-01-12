// Batchmaker schema types (manually defined since Supabase types generator
// only generates types for the public schema)

export interface BatchPreset {
  id: string
  naam: string
  retailer: string[]
  tags: string[]
  bezorgland: string[]
  leverdag: string[]
  pps: boolean
  created_at: string
  updated_at: string
}

export interface SingleOrderPreset {
  id: string
  naam: string
  retailer: string[]
  tags: string[]
  bezorgland: string[]
  leverdag: string[]
  pps: boolean
  created_at: string
  updated_at: string
}

export interface ExcludedProduct {
  id: string
  picqer_product_id: number
  productcode: string
  name: string
  last_synced_at: string
  created_at: string
  updated_at: string
}

// Insert types (without auto-generated fields)
export type BatchPresetInsert = Omit<BatchPreset, 'id' | 'created_at' | 'updated_at'>
export type SingleOrderPresetInsert = Omit<SingleOrderPreset, 'id' | 'created_at' | 'updated_at'>
export type ExcludedProductInsert = Omit<ExcludedProduct, 'id' | 'created_at' | 'updated_at'>

// Update types (all fields optional)
export type BatchPresetUpdate = Partial<BatchPresetInsert>
export type SingleOrderPresetUpdate = Partial<SingleOrderPresetInsert>
export type ExcludedProductUpdate = Partial<ExcludedProductInsert>
