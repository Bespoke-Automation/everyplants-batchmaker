'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, AlertCircle, Package, Search } from 'lucide-react'

interface ClassifiedProduct {
  id: string
  productcode: string
  product_name: string | null
  default_packaging_id: string | null
  shipping_unit_id: string | null
  pot_size: number | null
  height: number | null
}

interface PackagingOption {
  id: string
  name: string
  facturatie_box_sku: string | null
}

interface ShippingUnit {
  id: string
  name: string
}

interface CostData {
  total_cost: number
  carrier_code: string
}

type FilterMode = 'all' | 'set' | 'unset'

export default function DefaultPackagingList() {
  const [products, setProducts] = useState<ClassifiedProduct[]>([])
  const [packagings, setPackagings] = useState<PackagingOption[]>([])
  const [shippingUnits, setShippingUnits] = useState<Map<string, string>>(new Map())
  const [costs, setCosts] = useState<Record<string, CostData>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [statusRes, packRes, unitsRes, costsRes] = await Promise.all([
        fetch('/api/verpakking/products/status'),
        fetch('/api/verpakking/packagings?active=true'),
        fetch('/api/verpakking/shipping-units'),
        fetch('/api/verpakking/engine/costs?country=NL'),
      ])

      if (!statusRes.ok) throw new Error('Fout bij ophalen producten')
      if (!packRes.ok) throw new Error('Fout bij ophalen verpakkingen')

      const statusData = await statusRes.json()
      const packData = await packRes.json()

      setProducts(statusData.classifiedProducts || [])
      setPackagings(
        (packData.packagings || []).map((p: { id: string; name: string; facturatie_box_sku: string | null }) => ({
          id: p.id,
          name: p.name,
          facturatie_box_sku: p.facturatie_box_sku,
        }))
      )

      if (unitsRes.ok) {
        const unitsData = await unitsRes.json()
        const map = new Map<string, string>()
        for (const u of unitsData.shippingUnits || []) {
          map.set(u.id, u.name)
        }
        setShippingUnits(map)
      }

      if (costsRes.ok) {
        const costsData = await costsRes.json()
        setCosts(costsData.costs || {})
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDefaultPackagingChange = async (productAttributeId: string, packagingId: string | null) => {
    setSavingIds((prev) => new Set(prev).add(productAttributeId))

    try {
      const response = await fetch('/api/verpakking/product-attributes/default-packaging', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productAttributeId, packagingId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Fout bij opslaan')
      }

      setProducts((prev) =>
        prev.map((p) =>
          p.id === productAttributeId ? { ...p, default_packaging_id: packagingId } : p
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(productAttributeId)
        return next
      })
    }
  }

  // Build packaging SKU lookup
  const packagingSkuMap = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const p of packagings) {
      map.set(p.id, p.facturatie_box_sku)
    }
    return map
  }, [packagings])

  const getCostForPackaging = (packagingId: string | null): CostData | null => {
    if (!packagingId) return null
    const sku = packagingSkuMap.get(packagingId)
    if (!sku) return null
    return costs[sku] ?? null
  }

  // Filter and search
  const filteredProducts = useMemo(() => {
    let result = products

    if (filter === 'set') {
      result = result.filter((p) => p.default_packaging_id !== null)
    } else if (filter === 'unset') {
      result = result.filter((p) => p.default_packaging_id === null)
    }

    if (search.trim()) {
      const q = search.toLowerCase().trim()
      result = result.filter(
        (p) =>
          p.productcode.toLowerCase().includes(q) ||
          (p.product_name && p.product_name.toLowerCase().includes(q))
      )
    }

    return result
  }, [products, filter, search])

  const setCount = products.filter((p) => p.default_packaging_id !== null).length

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">Gegevens laden...</p>
        </div>
      </div>
    )
  }

  if (error && products.length === 0) {
    return (
      <div className="max-w-5xl mx-auto">
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
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Default Verpakkingen</h2>
            <p className="text-sm text-muted-foreground">
              {setCount} van {products.length} producten ingesteld
            </p>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Zoeken op naam of code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
        >
          <option value="all">Alle ({products.length})</option>
          <option value="set">Ingesteld ({setCount})</option>
          <option value="unset">Niet ingesteld ({products.length - setCount})</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/20 border-b border-border text-left">
                <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Product</th>
                <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Eenheid</th>
                <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Maat</th>
                <th className="px-4 py-2 text-xs font-medium text-muted-foreground min-w-[200px]">Default verpakking</th>
                <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Kosten NL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Geen producten gevonden
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => {
                  const costData = getCostForPackaging(product.default_packaging_id)
                  const unitName = product.shipping_unit_id
                    ? shippingUnits.get(product.shipping_unit_id) ?? '—'
                    : '—'

                  return (
                    <tr key={product.id} className="hover:bg-muted/10 transition-colors">
                      {/* Product */}
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium">{product.product_name || '—'}</div>
                        <div className="text-xs text-muted-foreground font-mono">{product.productcode}</div>
                      </td>

                      {/* Shipping Unit */}
                      <td className="px-4 py-3 text-sm">{unitName}</td>

                      {/* Maat */}
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {product.pot_size !== null ? `P${product.pot_size}` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {product.height !== null ? `${product.height} cm` : ''}
                        </div>
                      </td>

                      {/* Default packaging dropdown */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={product.default_packaging_id || ''}
                            onChange={(e) =>
                              handleDefaultPackagingChange(product.id, e.target.value || null)
                            }
                            disabled={savingIds.has(product.id)}
                            className={`block w-full max-w-[220px] px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 ${
                              !product.default_packaging_id ? 'text-muted-foreground' : ''
                            }`}
                          >
                            <option value="">Geen (engine bepaalt)</option>
                            {packagings.map((pkg) => (
                              <option key={pkg.id} value={pkg.id}>
                                {pkg.name}
                              </option>
                            ))}
                          </select>
                          {savingIds.has(product.id) && (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Kosten NL */}
                      <td className="px-4 py-3">
                        {costData ? (
                          <div>
                            <div className="text-sm font-medium">
                              &euro; {costData.total_cost.toFixed(2)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {costData.carrier_code}
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
