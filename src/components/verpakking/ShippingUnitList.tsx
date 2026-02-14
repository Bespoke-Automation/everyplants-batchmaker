'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, AlertCircle, Package2, Search } from 'lucide-react'

interface ShippingUnit {
  id: string
  name: string
  product_type: string
  sort_order: number
  is_active: boolean
  pot_size_min: number | null
  pot_size_max: number | null
  height_min: number | null
  height_max: number | null
  is_fragile_filter: boolean
  product_count: number
}

export default function ShippingUnitList() {
  const [shippingUnits, setShippingUnits] = useState<ShippingUnit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch('/api/verpakking/shipping-units')
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to fetch shipping units')
        }
        const result = await response.json()
        setShippingUnits(result.shippingUnits || [])
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [])

  // Filter by search query
  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return shippingUnits
    const query = searchQuery.toLowerCase()
    return shippingUnits.filter((unit) =>
      unit.name.toLowerCase().includes(query)
    )
  }, [shippingUnits, searchQuery])

  // Group by product_type
  const groupedUnits = useMemo(() => {
    const groups: Record<string, ShippingUnit[]> = {}
    for (const unit of filteredUnits) {
      if (!groups[unit.product_type]) {
        groups[unit.product_type] = []
      }
      groups[unit.product_type].push(unit)
    }
    return groups
  }, [filteredUnits])

  const formatRange = (min: number | null, max: number | null, suffix = '') => {
    if (min === null && max === null) return '—'
    if (min === null) return `≤ ${max}${suffix}`
    if (max === null) return `≥ ${min}${suffix}`
    if (min === max) return `${min}${suffix}`
    return `${min} – ${max}${suffix}`
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">Gegevens laden...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">Fout bij laden</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Package2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Verzendeenheden</h2>
          <p className="text-sm text-muted-foreground">
            Overzicht van alle actieve shipping units
          </p>
        </div>
      </div>

      {/* Search bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Zoek op naam..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          />
        </div>
      </div>

      {/* Grouped shipping units */}
      {Object.keys(groupedUnits).length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Package2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {searchQuery ? 'Geen resultaten gevonden' : 'Geen verzendeenheden beschikbaar'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedUnits)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([productType, units]) => (
              <div key={productType}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
                  {productType}
                </h3>
                <div className="space-y-2">
                  {units.map((unit) => (
                    <div
                      key={unit.id}
                      className="p-4 bg-card border border-border rounded-lg hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-semibold mb-2">{unit.name}</h4>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Potmaat:</span>
                              <span className="font-medium">
                                {formatRange(unit.pot_size_min, unit.pot_size_max, ' cm')}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">Hoogte:</span>
                              <span className="font-medium">
                                {formatRange(unit.height_min, unit.height_max, ' cm')}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {unit.is_fragile_filter && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Breekbaar
                            </span>
                          )}
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {unit.product_count} {unit.product_count === 1 ? 'product' : 'producten'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
