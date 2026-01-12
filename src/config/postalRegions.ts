/**
 * Predefined postal code regions for filtering orders by delivery area.
 * Each region can specify countries and optional postal code ranges.
 * If postalRanges is empty, all postal codes in those countries match.
 */

export interface PostalRange {
  country: string  // Country code (DE, NL, BE, etc.)
  from: string     // Start of postal code range
  to: string       // End of postal code range
}

export interface PostalRegion {
  id: string
  name: string
  countries: string[]
  postalRanges: PostalRange[]
}

export const POSTAL_REGIONS: PostalRegion[] = [
  {
    id: 'benelux',
    name: 'Benelux',
    countries: ['NL', 'BE', 'LU'],
    postalRanges: [], // All postal codes in these countries
  },
  {
    id: 'west-germany',
    name: 'West Duitsland',
    countries: ['DE'],
    postalRanges: [
      // Nordrhein-Westfalen
      { country: 'DE', from: '40000', to: '48999' },
      { country: 'DE', from: '50000', to: '53999' },
      { country: 'DE', from: '57000', to: '59999' },
      // Rheinland-Pfalz
      { country: 'DE', from: '54000', to: '56999' },
      // Saarland
      { country: 'DE', from: '66000', to: '66999' },
    ],
  },
  {
    id: 'south-germany',
    name: 'Zuid Duitsland',
    countries: ['DE'],
    postalRanges: [
      // Baden-Württemberg
      { country: 'DE', from: '68000', to: '79999' },
      // Bayern
      { country: 'DE', from: '80000', to: '87999' },
      { country: 'DE', from: '88000', to: '89999' },
      { country: 'DE', from: '90000', to: '97999' },
    ],
  },
  {
    id: 'north-germany',
    name: 'Noord Duitsland',
    countries: ['DE'],
    postalRanges: [
      // Hamburg, Schleswig-Holstein
      { country: 'DE', from: '20000', to: '25999' },
      // Niedersachsen (partial)
      { country: 'DE', from: '26000', to: '31999' },
      // Bremen
      { country: 'DE', from: '27000', to: '28999' },
    ],
  },
  {
    id: 'east-germany',
    name: 'Oost Duitsland',
    countries: ['DE'],
    postalRanges: [
      // Berlin
      { country: 'DE', from: '10000', to: '14999' },
      // Brandenburg
      { country: 'DE', from: '15000', to: '16999' },
      // Sachsen
      { country: 'DE', from: '01000', to: '09999' },
      // Sachsen-Anhalt
      { country: 'DE', from: '06000', to: '06999' },
      // Thüringen
      { country: 'DE', from: '98000', to: '99999' },
      // Mecklenburg-Vorpommern
      { country: 'DE', from: '17000', to: '19999' },
    ],
  },
  {
    id: 'france-north',
    name: 'Noord Frankrijk',
    countries: ['FR'],
    postalRanges: [
      // Nord-Pas-de-Calais
      { country: 'FR', from: '59000', to: '62999' },
      // Paris region
      { country: 'FR', from: '75000', to: '78999' },
      { country: 'FR', from: '91000', to: '95999' },
      // Picardy
      { country: 'FR', from: '02000', to: '02999' },
      { country: 'FR', from: '60000', to: '60999' },
      { country: 'FR', from: '80000', to: '80999' },
    ],
  },
  {
    id: 'austria',
    name: 'Oostenrijk',
    countries: ['AT'],
    postalRanges: [], // All postal codes in Austria
  },
]

/**
 * Check if an order's postal code matches a region
 */
export function matchesPostalRegion(
  country: string,
  postalCode: string | null,
  regionId: string
): boolean {
  const region = POSTAL_REGIONS.find(r => r.id === regionId)
  if (!region) return true // No region selected, match all

  // Check if country matches
  if (!region.countries.includes(country)) {
    return false
  }

  // If no postal ranges defined, all postal codes in those countries match
  if (region.postalRanges.length === 0) {
    return true
  }

  // Check postal code ranges
  if (!postalCode) return false

  // Normalize postal code (remove spaces, take only digits for comparison)
  const normalizedPostal = postalCode.replace(/\s/g, '')

  return region.postalRanges.some(range => {
    if (range.country !== country) return false
    return normalizedPostal >= range.from && normalizedPostal <= range.to
  })
}
