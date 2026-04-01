'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, AlertCircle, RefreshCw, Package, CheckCircle, AlertTriangle, XCircle, Search, ChevronLeft, ChevronRight, Database } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'

interface Product {
  id: string
  productcode: string
  product_name: string | null
  pot_size: number | null
  height: number | null
  product_type: string | null
  classification_status: string
  shipping_unit_id: string | null
  default_packaging_id: string | null
  image_url: string | null
}

interface Counts {
  total: number
  classified: number
  unclassified: number
  missing_data: number
  no_match: number
  error: number
}

interface StatusResponse {
  counts: Counts
  lastSyncedAt: string | null
  productTypes: string[]
  products: Product[]
  filteredCount: number
  page: number
  perPage: number
  totalPages: number
}

type StatusFilter = 'all' | 'classified' | 'unclassified' | 'missing_data' | 'no_match' | 'error'

const STATUS_TAB_DEFS: { id: StatusFilter; countKey: keyof Counts; color: string }[] = [
  { id: 'all', countKey: 'total', color: 'text-foreground' },
  { id: 'classified', countKey: 'classified', color: 'text-emerald-600' },
  { id: 'unclassified', countKey: 'unclassified', color: 'text-amber-600' },
  { id: 'missing_data', countKey: 'missing_data', color: 'text-orange-600' },
  { id: 'no_match', countKey: 'no_match', color: 'text-red-600' },
]

const BADGE_CLASSES: Record<string, string> = {
  classified: 'bg-emerald-100 text-emerald-700',
  unclassified: 'bg-amber-100 text-amber-700',
  missing_data: 'bg-orange-100 text-orange-700',
  no_match: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
}

const PER_PAGE = 50

export default function ProductStatus() {
  const { t } = useTranslation()
  const [data, setData] = useState<StatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [productType, setProductType] = useState('')
  const [page, setPage] = useState(1)

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  // Reset page on filter changes
  useEffect(() => {
    setPage(1)
  }, [statusFilter, productType])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        status: statusFilter,
        page: page.toString(),
        per_page: PER_PAGE.toString(),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (productType) params.set('product_type', productType)

      const response = await fetch(`/api/verpakking/products/status?${params}`)
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
  }, [statusFilter, debouncedSearch, productType, page])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleSync = async () => {
    setIsSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/sync/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full' }),
      })
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

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t.settings.never
    const date = new Date(dateString)
    return date.toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Initial loading (no data yet)
  if (isLoading && !data) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">{t.settings.loadingData}</p>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">{t.settings.loadError}</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { counts, products, filteredCount, totalPages, productTypes } = data

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{t.settings.productStatus}</h2>
            <p className="text-sm text-muted-foreground">
              {t.settings.productStatusDescription}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data.lastSyncedAt && (
            <span className="text-xs text-muted-foreground">
              {t.settings.lastSync}: {formatDate(data.lastSyncedAt)}
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
                {t.settings.syncing}
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4" />
                {t.settings.syncFromPicqer}
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
        <div className="p-4 bg-card border border-border rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase">{t.settings.total}</span>
          </div>
          <p className="text-3xl font-bold">{counts.total}</p>
        </div>
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700 uppercase">{t.settings.classified}</span>
          </div>
          <p className="text-3xl font-bold text-emerald-600">{counts.classified}</p>
        </div>
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-medium text-amber-700 uppercase">{t.settings.unclassified}</span>
          </div>
          <p className="text-3xl font-bold text-amber-600">{counts.unclassified}</p>
        </div>
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-orange-600" />
            <span className="text-xs font-medium text-orange-700 uppercase">{t.settings.noData}</span>
          </div>
          <p className="text-3xl font-bold text-orange-600">{counts.missing_data + counts.no_match}</p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-muted rounded-lg mb-4">
        {STATUS_TAB_DEFS.map((tab) => {
          const count = counts[tab.countKey]
          const tabLabels: Record<StatusFilter, string> = {
            all: t.settings.all,
            classified: t.settings.classified,
            unclassified: t.settings.unclassified,
            missing_data: t.settings.noData,
            no_match: t.settings.noMatch,
            error: t.common.error,
          }
          return (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                statusFilter === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tabLabels[tab.id]}
              <span className={`ml-1.5 ${statusFilter === tab.id ? tab.color : ''}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search + Type filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder={t.settings.searchByNameOrCode}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
          />
        </div>
        <select
          value={productType}
          onChange={(e) => setProductType(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[44px]"
        >
          <option value="">{t.settings.allTypes}</option>
          {productTypes.map((pt) => (
            <option key={pt} value={pt}>{pt}</option>
          ))}
        </select>
      </div>

      {/* Results count + pagination info */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          {filteredCount} {filteredCount === 1 ? t.common.product : t.common.products} {t.settings.found}
          {isLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-2" />}
        </span>
        {totalPages > 1 && (
          <span className="text-xs text-muted-foreground">
            {t.settings.page} {page} {t.common.of} {totalPages}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        {products.length === 0 ? (
          <div className="p-8 text-center">
            {statusFilter === 'unclassified' && !search && !productType ? (
              <>
                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <p className="text-sm font-medium text-emerald-600">{t.settings.allClassified}</p>
              </>
            ) : (
              <>
                <XCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">{t.settings.noProductsFound}</p>
              </>
            )}
          </div>
        ) : (
          <table className="w-full table-fixed">
            <thead>
              <tr className="bg-muted/20 border-b border-border text-left">
                <th className="w-[18%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.productCode}</th>
                <th className="w-[32%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.name}</th>
                <th className="w-[10%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.potSize}</th>
                <th className="w-[10%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.plantHeight}</th>
                <th className="w-[14%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.type}</th>
                <th className="w-[16%] px-4 py-2 text-xs font-medium text-muted-foreground">{t.settings.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {products.map((product) => {
                const badgeLabels: Record<string, string> = {
                  classified: t.settings.classified,
                  unclassified: t.settings.unclassified,
                  missing_data: t.settings.noData,
                  no_match: t.settings.noMatch,
                  error: t.common.error,
                }
                const badgeClass = BADGE_CLASSES[product.classification_status] || BADGE_CLASSES.error
                const badgeLabel = badgeLabels[product.classification_status] || t.common.error
                return (
                  <tr key={product.id} className="hover:bg-muted/10 transition-colors">
                    <td className="px-4 py-2.5 text-sm font-mono truncate">{product.productcode}</td>
                    <td className="px-4 py-2.5 text-sm truncate">{product.product_name || '—'}</td>
                    <td className="px-4 py-2.5 text-sm">
                      {product.pot_size !== null ? `P${product.pot_size}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {product.height !== null ? `${product.height} cm` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-sm truncate">{product.product_type || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded-full ${badgeClass}`}>
                        {badgeLabel}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
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
            {t.settings.previous}
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
            {t.common.next}
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
