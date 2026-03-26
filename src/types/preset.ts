export interface Preset {
  id: string
  naam: string
  retailer: string[]
  tags: string[]
  tags_exclusive?: boolean
  bezorgland: string[]
  leverdag: string[]
  pps: boolean
  postal_regions?: string[]
  vervoerders?: string[]
}
