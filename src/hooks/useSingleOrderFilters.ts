'use client'

import { useState, useMemo, useCallback } from 'react'
import { FilterState, initialFilterState } from '@/types/filters'
import { ProductGroup, SingleOrderWithProduct } from '@/types/singleOrder'
import { Preset } from '@/types/preset'
import { PostalRegion, matchesPostalRegion } from '@/lib/supabase/postalRegions'

// Main countries for the "Overig" logic
const KNOWN_COUNTRIES = ['NL', 'BE', 'DE', 'FR', 'AT', 'LU', 'ES', 'IT', 'SE']

// Normalize tag names for comparison
function normalizeTag(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ')
}

// Filter a single order based on filter state
function orderMatchesFilters(
  order: SingleOrderWithProduct,
  filters: FilterState,
  postalRegions: PostalRegion[]
): boolean {
  // Always exclude PPS orders (orders with plantnummer) from single orders
  if (order.hasPlantnummer) {
    return false
  }

  const normalizedFilterTags = filters.tags.map(normalizeTag)

  // Retailer filter
  if (filters.retailers.length > 0) {
    if (!filters.retailers.includes(order.retailerName)) {
      return false
    }
  }

  // Tags filter
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

  // Postal region filter
  if (filters.postalRegion) {
    const region = postalRegions.find(r => r.region_id === filters.postalRegion)
    if (region && !matchesPostalRegion(order.bezorgland, order.deliveryPostalCode, region)) {
      return false
    }
  }

  return true
}

// Minimum orders for a group to be shown
const MIN_GROUP_SIZE = 5

export function useSingleOrderFilters(groups: ProductGroup[], postalRegions: PostalRegion[] = []) {
  const [filters, setFilters] = useState<FilterState>(initialFilterState)

  const filteredGroups = useMemo(() => {
    return groups
      .map(group => {
        // Filter orders within the group
        const filteredOrders = group.orders.filter(order =>
          orderMatchesFilters(order, filters, postalRegions)
        )

        // Recalculate retailer breakdown
        const retailerBreakdown: Record<string, number> = {}
        for (const order of filteredOrders) {
          retailerBreakdown[order.retailerName] = (retailerBreakdown[order.retailerName] || 0) + 1
        }

        return {
          ...group,
          orders: filteredOrders,
          totalCount: filteredOrders.length,
          retailerBreakdown,
        }
      })
      // Only keep groups with MIN_GROUP_SIZE or more orders
      .filter(group => group.totalCount >= MIN_GROUP_SIZE)
      // Sort by total count descending
      .sort((a, b) => b.totalCount - a.totalCount)
  }, [groups, filters, postalRegions])

  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilters(initialFilterState)
  }, [])

  const applyPreset = useCallback((preset: Preset) => {
    setFilters({
      retailers: preset.retailer,
      tags: preset.tags,
      countries: preset.bezorgland,
      leverdagen: preset.leverdag,
      pps: preset.pps ? 'ja' : 'nee',
      postalRegion: preset.postal_region || undefined,
    })
  }, [])

  return {
    filters,
    filteredGroups,
    updateFilter,
    resetFilters,
    applyPreset,
  }
}
