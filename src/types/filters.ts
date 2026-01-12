export interface FilterState {
  retailers: string[]
  tags: string[]
  countries: string[]
  leverdagen: string[]
  pps: 'ja' | 'nee'
  postalRegion?: string  // ID of selected postal region
}

// All retailers selected by default (matching Retool behavior)
export const ALL_RETAILERS = [
  'Green Bubble',
  'Everspring',
  'Ogreen',
  'Florafy',
  'Trendyplants',
  'Plantura',
]

export const initialFilterState: FilterState = {
  retailers: ALL_RETAILERS,
  tags: [],
  countries: [],
  leverdagen: [],
  pps: 'nee',
}
