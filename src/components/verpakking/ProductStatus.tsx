'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, RefreshCw, Package, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'

interface ClassifiedProduct {
  id: string
  productcode: string
  product_name: string | null
  default_packaging_id: string | null
}

interface PackagingOption {
  id: string
  name: string
}

interface ProductStatusData {
  total: number
  classified: number
  unclassified: number
  error: number
  pending: number
  lastSyncedAt: string | null
  unclassifiedProducts: Array<{
    productcode: string
    product_name: string | null
    pot_size: number | null
    height: number | null
    product_type: string | null
  }>
  classifiedProducts: ClassifiedProduct[]
}

export default function ProductStatus() {
  const [data, setData] = useState<ProductStatusData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [packagings, setPackagings] = useState<PackagingOption[]>([])
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())

  const fetchData = async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/products/status')
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch product status')
      }
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }

  const fetchPackagings = useCallback(async () => {
    try {
      const response = await fetch('/api/verpakking/packagings?active=true')
      if (!response.ok) return
      const result = await response.json()
      setPackagings(
        (result.packagings || []).map((p: { id: string; name: string }) => ({
          id: p.id,
          name: p.name,
        }))
      )
    } catch {
      // Silently fail — packagings are optional for the overview
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetchPackagings()
  }, [fetchPackagings])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/sync/products', { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to sync products')
      }
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsSyncing(false)
    }
  }

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
        throw new Error(errorData.error || 'Failed to update default packaging')
      }

      // Update local state
      setData((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          classifiedProducts: prev.classifiedProducts.map((p) =>
            p.id === productAttributeId ? { ...p, default_packaging_id: packagingId } : p
          ),
        }
      })
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

  if (error && !data) {
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

  if (!data) return null

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Nooit'
    const date = new Date(dateString)
    return date.toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Product Status</h2>
            <p className="text-sm text-muted-foreground">
              Overzicht van product classificatie
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data.lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              Laatste sync: {formatDate(data.lastSyncedAt)}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            {isSyncing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Synchroniseren...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                Sync van Picqer
              </>
            )}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {/* Total */}
        <div className="p-4 bg-card border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase">Totaal</span>
          </div>
          <p className="text-3xl font-bold">{data.total}</p>
        </div>

        {/* Classified */}
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700 uppercase">Geclassificeerd</span>
          </div>
          <p className="text-3xl font-bold text-emerald-600">{data.classified}</p>
        </div>

        {/* Unclassified */}
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700 uppercase">Ongeclassificeerd</span>
          </div>
          <p className="text-3xl font-bold text-amber-600">{data.unclassified}</p>
        </div>

        {/* Errors */}
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs font-medium text-red-700 uppercase">Fouten</span>
          </div>
          <p className="text-3xl font-bold text-red-600">{data.error}</p>
        </div>
      </div>

      {/* Classified Products with Default Packaging */}
      {data.classifiedProducts.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden mb-6">
          <div className="px-4 py-3 bg-muted/30 border-b border-border">
            <h3 className="text-sm font-semibold">Geclassificeerde Producten</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Stel per product een standaard verpakking in voor single-SKU orders
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/20 border-b border-border text-left">
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Productcode</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Naam</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Standaard verpakking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.classifiedProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono">{product.productcode}</td>
                    <td className="px-4 py-3 text-sm">{product.product_name || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <select
                          value={product.default_packaging_id || ''}
                          onChange={(e) =>
                            handleDefaultPackagingChange(
                              product.id,
                              e.target.value || null
                            )
                          }
                          disabled={savingIds.has(product.id)}
                          className="block w-full max-w-xs px-2 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                        >
                          <option value="">Geen standaard</option>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Unclassified Products Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted/30 border-b border-border">
          <h3 className="text-sm font-semibold">Ongeclassificeerde Producten</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {data.unclassifiedProducts.length > 0
              ? `Eerste ${data.unclassifiedProducts.length} producten (max 100)`
              : 'Geen ongeclassificeerde producten'}
          </p>
        </div>

        {data.unclassifiedProducts.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-emerald-600">Alle producten zijn geclassificeerd</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/20 border-b border-border text-left">
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Productcode</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Naam</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Potmaat</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Hoogte</th>
                  <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.unclassifiedProducts.map((product) => (
                  <tr key={product.productcode} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-3 text-sm font-mono">{product.productcode}</td>
                    <td className="px-4 py-3 text-sm">{product.product_name || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      {product.pot_size !== null ? `P${product.pot_size}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {product.height !== null ? `${product.height} cm` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">{product.product_type || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
