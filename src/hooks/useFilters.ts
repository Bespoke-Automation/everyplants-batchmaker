'use client'

import { useState, useMemo, useCallback } from 'react'
import { FilterState, initialFilterState } from '@/types/filters'
import { TransformedOrder } from '@/types/order'
import { Preset } from '@/types/preset'
import { PostalRegion, matchesPostalRegion } from '@/lib/supabase/postalRegions'

// Main countries for the "Overig" logic
const KNOWN_COUNTRIES = ['NL', 'BE', 'DE', 'FR', 'AT', 'LU', 'ES', 'IT', 'SE']

// Normalize tag names for comparison (trim whitespace, normalize multiple spaces)
function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ')
}

export type SortOrder = 'oldest' | 'newest'

export function useFilters(orders: TransformedOrder[], postalRegions: PostalRegion[] = []) {
  const [filters, setFilters] = useState<FilterState>(initialFilterState)
  const [sortOrder, setSortOrder] = useState<SortOrder>('oldest')
  const [maxResults, setMaxResults] = useState<number | null>(null)

  const filteredOrders = useMemo(() => {
    // Pre-normalize filter tags for comparison
    const normalizedFilterTags = filters.tags.map(normalizeTag)

    const filtered = orders.filter(order => {
      // Retailer filter
      if (filters.retailers.length > 0) {
        if (!filters.retailers.includes(order.retailerName)) {
          return false
        }
      }

      // Tags filter (order must have at least one of the selected tags)
      // Uses normalized comparison to handle inconsistent spacing
      if (filters.tags.length > 0) {
        const normalizedOrderTags = order.tagTitles.map(normalizeTag)
        const hasMatchingTag = normalizedFilterTags.some(filterTag =>
          normalizedOrderTags.includes(filterTag)
        )
        if (!hasMatchingTag) {
          return false
        }
      }

      // Country filter with "Overig" handling
      if (filters.countries.length > 0) {
        const isOverig = !KNOWN_COUNTRIES.includes(order.bezorgland)
        const matchesCountry = filters.countries.includes(order.bezorgland)
        const matchesOverig = filters.countries.includes('Overig') && isOverig

        // If only "Overig" is selected, show only unknown countries
        if (filters.countries.length === 1 && filters.countries.includes('Overig')) {
          if (!isOverig) return false
        } else if (!matchesCountry && !matchesOverig) {
          return false
        }
      }

      // Leverdag filter
      if (filters.leverdagen.length > 0) {
        if (!filters.leverdagen.includes(order.leverdag)) {
          return false
        }
      }

      // PPS filter (has plantnummer) - always applied
      if (filters.pps === 'ja' && !order.hasPlantnummer) {
        return false
      }
      if (filters.pps === 'nee' && order.hasPlantnummer) {
        return false
      }

      // Postal region filter (matches if order is in ANY of the selected regions)
      if (filters.postalRegions?.length) {
        const matchesAnyRegion = filters.postalRegions.some(regionId => {
          const region = postalRegions.find(r => r.region_id === regionId)
          return region && matchesPostalRegion(order.bezorgland, order.deliveryPostalCode, region)
        })
        if (!matchesAnyRegion) {
          return false
        }
      }

      return true
    })

    // Sort by created date
    filtered.sort((a, b) => {
      const cmp = a.created.localeCompare(b.created)
      return sortOrder === 'oldest' ? cmp : -cmp
    })

    // Limit results
    if (maxResults !== null && maxResults > 0) {
      return filtered.slice(0, maxResults)
    }

    return filtered
  }, [orders, filters, postalRegions, sortOrder, maxResults])

  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(initialFilterState)
    setSortOrder('oldest')
    setMaxResults(null)
  }, [])

  const applyPreset = useCallback((preset: Preset) => {
    setFilters({
      retailers: preset.retailer,
      tags: preset.tags,
      countries: preset.bezorgland,
      leverdagen: preset.leverdag,
      pps: preset.pps ? 'ja' : 'nee',
      postalRegions: preset.postal_regions?.length ? preset.postal_regions : undefined,
    })
  }, [])

  const updateSortOrder = useCallback((order: SortOrder) => {
    setSortOrder(order)
  }, [])

  const updateMaxResults = useCallback((value: number | null) => {
    setMaxResults(value)
  }, [])

  return {
    filters,
    filteredOrders,
    updateFilter,
    resetFilters,
    applyPreset,
    sortOrder,
    maxResults,
    updateSortOrder,
    updateMaxResults,
  }
}
