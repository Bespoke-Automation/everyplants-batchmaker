export interface Preset {
  id: string
  naam: string
  retailer: string[]
  tags: string[]
  bezorgland: string[]
  leverdag: string[]
  pps: boolean
  postal_regions?: string[]
}
