'use client'

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { Loader2, AlertCircle, Package, Search, Upload, CheckCircle2, Tag, Box, Layers, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'

interface ClassifiedProduct {
  id: string
  productcode: string
  product_name: string | null
  default_packaging_id: string | null
  shipping_unit_id: string | null
  pot_size: number | null
  height: number | null
  image_url: string | null
}

interface PackagingOption {
  id: string
  name: string
  idpackaging: number
  barcode: string | null
  facturatie_box_sku: string | null
  picqer_tag_name: string | null
}

interface ShippingUnit {
  id: string
  name: string
}

interface CostData {
  total_cost: number
  carrier_code: string
}

const COST_COUNTRIES_PRIMARY = ['NL', 'DE', 'FR', 'BE'] as const
const COST_COUNTRIES_EXTRA = ['AT', 'LU', 'SE', 'IT', 'ES'] as const
const ALL_COST_COUNTRIES = [...COST_COUNTRIES_PRIMARY, ...COST_COUNTRIES_EXTRA] as const

interface ImportResult {
  matched: number
  updated_packaging: number
  enriched_dimensions: number
  not_found_in_batchmaker: string[]
  skipped_zoud: number
  skipped_type: number
  skipped_no_packaging: number
  unmapped_packaging_ids: string[]
  total_rows: number
}

type FilterMode = 'all' | 'set' | 'unset'

export default function DefaultPackagingList() {
  const [products, setProducts] = useState<ClassifiedProduct[]>([])
  const [packagings, setPackagings] = useState<PackagingOption[]>([])
  const [shippingUnits, setShippingUnits] = useState<Map<string, string>>(new Map())
  const [costs, setCosts] = useState<Record<string, Record<string, CostData>>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterMode>('all')
  const [packagingFilter, setPackagingFilter] = useState<string>('all')
  const [unitFilter, setUnitFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  // Expanded row for extra country costs
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null)

  // Bulk assign state
  const [bulkPackagingId, setBulkPackagingId] = useState<string>('')
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [bulkResult, setBulkResult] = useState<{ count: number; name: string } | null>(null)

  // Import state
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [classifiedRes, packRes, unitsRes, costsRes] = await Promise.all([
        fetch('/api/verpakking/product-attributes/classified'),
        fetch('/api/verpakking/packagings?active=true'),
        fetch('/api/verpakking/shipping-units'),
        fetch(`/api/verpakking/engine/costs?countries=${ALL_COST_COUNTRIES.join(',')}`),
      ])

      if (!classifiedRes.ok) throw new Error('Fout bij ophalen producten')
      if (!packRes.ok) throw new Error('Fout bij ophalen verpakkingen')

      const classifiedData = await classifiedRes.json()
      const packData = await packRes.json()

      setProducts(classifiedData.products || [])
      setPackagings(
        (packData.packagings || []).map((p: PackagingOption) => ({
          id: p.id,
          name: p.name,
          idpackaging: p.idpackaging,
          barcode: p.barcode,
          facturatie_box_sku: p.facturatie_box_sku,
          picqer_tag_name: p.picqer_tag_name,
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

  // Import handler
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    setImportResult(null)
    setError(null)

    try {
      const text = await file.text()
      const response = await fetch('/api/verpakking/import-everspring', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      })

      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Import mislukt')

      setImportResult(result)
      await fetchData() // Refresh data
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Import fout'))
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Bulk assign handler
  const handleBulkAssign = async () => {
    if (!bulkPackagingId) return
    const ids = filteredProducts.map((p) => p.id)
    if (ids.length === 0) return

    const pkgName = packagings.find((p) => p.id === bulkPackagingId)?.name || '?'
    const confirmed = window.confirm(
      `Weet je zeker dat je "${pkgName}" wilt toewijzen aan ${ids.length} ${ids.length === 1 ? 'product' : 'producten'}?`
    )
    if (!confirmed) return

    setIsBulkSaving(true)
    setBulkResult(null)
    setError(null)

    try {
      const packagingValue = bulkPackagingId === 'none' ? null : bulkPackagingId

      const response = await fetch('/api/verpakking/product-attributes/default-packaging/bulk', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productAttributeIds: ids, packagingId: packagingValue }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Bulk update mislukt')
      }

      // Update local state
      const idSet = new Set(ids)
      setProducts((prev) =>
        prev.map((p) =>
          idSet.has(p.id) ? { ...p, default_packaging_id: packagingValue } : p
        )
      )
      setBulkResult({ count: ids.length, name: packagingValue ? pkgName : 'Geen (engine bepaalt)' })
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Bulk update fout'))
    } finally {
      setIsBulkSaving(false)
    }
  }

  // Lookups
  const packagingMap = useMemo(() => {
    const map = new Map<string, PackagingOption>()
    for (const p of packagings) map.set(p.id, p)
    return map
  }, [packagings])

  const getCostForPackaging = (packagingId: string | null, country: string): CostData | null => {
    if (!packagingId) return null
    const pkg = packagingMap.get(packagingId)
    if (!pkg?.facturatie_box_sku) return null
    return costs[country]?.[pkg.facturatie_box_sku] ?? null
  }

  const getPackagingInfo = (packagingId: string | null) => {
    if (!packagingId) return null
    return packagingMap.get(packagingId) ?? null
  }

  // Unique shipping units used by products (for filter dropdown)
  const usedUnitIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of products) {
      if (p.shipping_unit_id) ids.add(p.shipping_unit_id)
    }
    return ids
  }, [products])

  // Unique packaging IDs used by products (for filter dropdown)
  const usedPackagingIds = useMemo(() => {
    const ids = new Set<string>()
    for (const p of products) {
      if (p.default_packaging_id) ids.add(p.default_packaging_id)
    }
    return ids
  }, [products])

  // Filter and search
  const filteredProducts = useMemo(() => {
    let result = products

    if (filter === 'set') {
      result = result.filter((p) => p.default_packaging_id !== null)
    } else if (filter === 'unset') {
      result = result.filter((p) => p.default_packaging_id === null)
    }

    if (packagingFilter === '_empty') {
      result = result.filter((p) => p.default_packaging_id === null)
    } else if (packagingFilter !== 'all') {
      result = result.filter((p) => p.default_packaging_id === packagingFilter)
    }

    if (unitFilter === '_empty') {
      result = result.filter((p) => p.shipping_unit_id === null)
    } else if (unitFilter !== 'all') {
      result = result.filter((p) => p.shipping_unit_id === unitFilter)
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
  }, [products, filter, packagingFilter, unitFilter, search])

  // Reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [filter, packagingFilter, unitFilter, search])

  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE)
  const paginatedProducts = useMemo(() => {
    const from = (page - 1) * PAGE_SIZE
    return filteredProducts.slice(from, from + PAGE_SIZE)
  }, [filteredProducts, page])

  const setCount = products.filter((p) => p.default_packaging_id !== null).length

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">Gegevens laden...</p>
        </div>
      </div>
    )
  }

  if (error && products.length === 0) {
    return (
      <div className="max-w-7xl mx-auto">
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
    <div className="max-w-7xl mx-auto">
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
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors min-h-[44px] disabled:opacity-50"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Importeer Everspring CSV
          </button>
        </div>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
          <div className="flex items-center gap-2 font-medium text-emerald-800 mb-2">
            <CheckCircle2 className="w-4 h-4" /> Import voltooid
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-emerald-700">
            <div>Totaal rijen: {importResult.total_rows}</div>
            <div>Gematcht: {importResult.matched}</div>
            <div>Verpakking: {importResult.updated_packaging}</div>
            <div>Maten verrijkt: {importResult.enriched_dimensions}</div>
            <div>Z-OUD skip: {importResult.skipped_zoud}</div>
          </div>
          {importResult.not_found_in_batchmaker.length > 0 && (
            <div className="mt-2 text-amber-700">
              <span className="font-medium">{importResult.not_found_in_batchmaker.length} producten niet gevonden in batchmaker</span>
              <span className="text-xs ml-1">(eerste 10: {importResult.not_found_in_batchmaker.slice(0, 10).join(', ')})</span>
            </div>
          )}
          {importResult.unmapped_packaging_ids.length > 0 && (
            <div className="mt-1 text-amber-700">
              <span className="font-medium">Onbekende Everspring Packaging IDs:</span>
              <span className="text-xs ml-1">{importResult.unmapped_packaging_ids.join(', ')}</span>
            </div>
          )}
          <button onClick={() => setImportResult(null)} className="mt-2 text-xs text-emerald-600 underline">Sluiten</button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* Search + Filters */}
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
        <select
          value={packagingFilter}
          onChange={(e) => setPackagingFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
        >
          <option value="all">Alle verpakkingen</option>
          <option value="_empty">Niet ingesteld</option>
          {packagings
            .filter((p) => usedPackagingIds.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
        </select>
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
        >
          <option value="all">Alle eenheden</option>
          <option value="_empty">Niet ingesteld</option>
          {Array.from(usedUnitIds).map((id) => (
            <option key={id} value={id}>{shippingUnits.get(id) || id}</option>
          ))}
        </select>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {filteredProducts.length} {filteredProducts.length === 1 ? 'product' : 'producten'} gevonden
        </span>
        {totalPages > 1 && (
          <span className="text-xs text-muted-foreground">
            Pagina {page} van {totalPages}
          </span>
        )}
      </div>

      {/* Bulk assign bar */}
      {filteredProducts.length > 0 && (
        <div className="mb-3 p-3 bg-muted/30 border border-border rounded-lg flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground shrink-0">
            <Layers className="w-4 h-4" />
            Bulk toewijzen aan {filteredProducts.length} producten:
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <select
              value={bulkPackagingId}
              onChange={(e) => setBulkPackagingId(e.target.value)}
              disabled={isBulkSaving}
              className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
            >
              <option value="">Kies verpakking...</option>
              <option value="none">Geen (engine bepaalt)</option>
              {packagings.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={handleBulkAssign}
              disabled={!bulkPackagingId || isBulkSaving}
              className="shrink-0 inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[36px]"
            >
              {isBulkSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                'Toepassen'
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bulk result */}
      {bulkResult && (
        <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            <span><strong>{bulkResult.count}</strong> producten bijgewerkt naar <strong>{bulkResult.name}</strong></span>
          </div>
          <button onClick={() => setBulkResult(null)} className="text-xs text-emerald-600 underline">Sluiten</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full table-fixed min-w-[1200px]">
            <thead>
              <tr className="bg-muted/20 border-b border-border text-left">
                <th className="w-[16%] px-3 py-2 text-xs font-medium text-muted-foreground">Product</th>
                <th className="w-[7%] px-3 py-2 text-xs font-medium text-muted-foreground">Eenheid</th>
                <th className="w-[4%] px-3 py-2 text-xs font-medium text-muted-foreground">Maat</th>
                <th className="w-[15%] px-3 py-2 text-xs font-medium text-muted-foreground">Default verpakking</th>
                <th className="w-[10%] px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Tag className="w-3 h-3" /> Tag</span>
                </th>
                <th className="w-[7%] px-3 py-2 text-xs font-medium text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Box className="w-3 h-3" /> idpackaging</span>
                </th>
                <th className="w-[8%] px-3 py-2 text-xs font-medium text-muted-foreground">Barcode</th>
                {COST_COUNTRIES_PRIMARY.map(c => (
                  <th key={c} className="w-[7%] px-3 py-2 text-xs font-medium text-muted-foreground text-right">{c}</th>
                ))}
                <th className="w-[3%] px-1 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8 + COST_COUNTRIES_PRIMARY.length} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Geen producten gevonden
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => {
                  const pkg = getPackagingInfo(product.default_packaging_id)
                  const unitName = product.shipping_unit_id
                    ? shippingUnits.get(product.shipping_unit_id) ?? '—'
                    : '—'

                  return (
                    <Fragment key={product.id}>
                    <tr className="hover:bg-muted/10 transition-colors">
                      {/* Product */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.product_name || product.productcode}
                              className="w-10 h-10 rounded object-cover shrink-0 bg-muted"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0">
                              <Package className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{product.product_name || '—'}</div>
                            <div className="text-xs text-muted-foreground font-mono">{product.productcode}</div>
                          </div>
                        </div>
                      </td>

                      {/* Shipping Unit */}
                      <td className="px-3 py-2.5 text-xs truncate">{unitName}</td>

                      {/* Maat */}
                      <td className="px-3 py-2.5">
                        <div className="text-xs">
                          {product.pot_size !== null ? `P${product.pot_size}` : '—'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {product.height !== null ? `${product.height}cm` : ''}
                        </div>
                      </td>

                      {/* Default packaging dropdown */}
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={product.default_packaging_id || ''}
                            onChange={(e) =>
                              handleDefaultPackagingChange(product.id, e.target.value || null)
                            }
                            disabled={savingIds.has(product.id)}
                            className={`block w-full px-2 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 truncate ${
                              !product.default_packaging_id ? 'text-muted-foreground' : ''
                            }`}
                          >
                            <option value="">Geen (engine bepaalt)</option>
                            {packagings.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          {savingIds.has(product.id) && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
                          )}
                        </div>
                      </td>

                      {/* Picqer Tag */}
                      <td className="px-3 py-2.5">
                        {pkg?.picqer_tag_name ? (
                          <span className="text-xs font-medium">{pkg.picqer_tag_name}</span>
                        ) : pkg ? (
                          <span className="text-xs text-muted-foreground italic">geen tag</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Picqer Packaging */}
                      <td className="px-3 py-2.5">
                        {pkg ? (
                          pkg.idpackaging > 0 ? (
                            <span className="text-xs font-mono">{pkg.idpackaging}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">lokaal</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Barcode */}
                      <td className="px-3 py-2.5">
                        {pkg?.barcode ? (
                          <span className="text-xs font-mono">{pkg.barcode}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Kosten per land (primair) */}
                      {COST_COUNTRIES_PRIMARY.map(country => {
                        const costData = getCostForPackaging(product.default_packaging_id, country)
                        return (
                          <td key={country} className="px-3 py-2.5 text-right">
                            {costData ? (
                              <div>
                                <div className="text-xs font-medium tabular-nums">
                                  &euro;{costData.total_cost.toFixed(2)}
                                </div>
                                <div className="text-[10px] text-muted-foreground">
                                  {costData.carrier_code}
                                </div>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        )
                      })}

                      {/* Expand toggle */}
                      <td className="px-1 py-2.5 text-center">
                        {product.default_packaging_id && (
                          <button
                            onClick={() => setExpandedProductId(prev => prev === product.id ? null : product.id)}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            title="Meer landen"
                          >
                            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedProductId === product.id ? 'rotate-180' : ''}`} />
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded row: extra country costs */}
                    {expandedProductId === product.id && product.default_packaging_id && (
                      <tr className="bg-muted/5 border-b border-border">
                        <td colSpan={8 + COST_COUNTRIES_PRIMARY.length} className="px-4 py-2">
                          <div className="flex items-center gap-6">
                            <span className="text-xs text-muted-foreground shrink-0">Overige landen</span>
                            {COST_COUNTRIES_EXTRA.map(country => {
                              const costData = getCostForPackaging(product.default_packaging_id, country)
                              return (
                                <div key={country} className="text-right min-w-[60px]">
                                  <div className="text-[10px] text-muted-foreground font-medium">{country}</div>
                                  {costData ? (
                                    <>
                                      <div className="text-xs font-medium tabular-nums">&euro;{costData.total_cost.toFixed(2)}</div>
                                      <div className="text-[10px] text-muted-foreground">{costData.carrier_code}</div>
                                    </>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  )
                })
              )}
            </tbody>
          </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            <ChevronLeft className="w-4 h-4" />
            Vorige
          </button>

          <div className="flex items-center gap-1">
            {generatePageNumbers(page, totalPages).map((p, i) =>
              p === '...' ? (
                <span key={`dots-${i}`} className="px-2 text-sm text-muted-foreground">...</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p as number)}
                  className={`w-9 h-9 text-sm font-medium rounded-md transition-colors ${
                    page === p
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {p}
                </button>
              )
            )}
          </div>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed min-h-[44px]"
          >
            Volgende
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  )
}

/** Generate page number array with ellipsis */
function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)

  const pages: (number | string)[] = [1]

  if (current > 3) pages.push('...')

  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)

  for (let i = start; i <= end; i++) pages.push(i)

  if (current < total - 2) pages.push('...')

  pages.push(total)

  return pages
}
