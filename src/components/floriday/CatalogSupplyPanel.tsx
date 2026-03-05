'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Send, Package, Link2, Link2Off } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────

interface CatalogProduct {
  picqerProductId: number
  productcode: string
  name: string
  altSku: string | null
  tradeItemId: string | null
  vbnCode: number | null
  lastSyncedAt: string | null
}

interface WeekSyncDetail {
  year: number
  week: number
  totalStock: number
  action: 'bulk_put' | 'skipped_frozen' | 'skipped_unmapped' | 'error'
  error?: string
}

interface SyncDetail {
  picqerProductId: number
  productcode?: string
  name?: string
  tradeItemId?: string
  weekResults: WeekSyncDetail[]
  success: boolean
  error?: string
}

interface SyncResponse {
  success: boolean
  synced: number
  skipped: number
  errors: number
  frozenWeeks: string[]
  details: SyncDetail[]
}

// ─── Week badge component ──────────────────────────────────

function WeekBadge({ detail }: { detail: WeekSyncDetail }) {
  if (detail.action === 'bulk_put') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
        {detail.totalStock}
      </span>
    )
  }
  if (detail.action === 'skipped_frozen') {
    return (
      <span
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 cursor-help"
        title={detail.error ?? 'Pricing freeze'}
      >
        <AlertTriangle className="w-3 h-3" />
        {detail.totalStock}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 cursor-help"
      title={detail.error ?? 'Fout'}
    >
      <XCircle className="w-3 h-3" />
    </span>
  )
}

// ─── Hoofdcomponent ────────────────────────────────────────

export default function CatalogSupplyPanel() {
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [weekHeaders, setWeekHeaders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/floriday/catalog-supply/products')
      const json = await res.json()
      if (json.success) {
        setProducts(json.products)
        setWeekHeaders(json.weekHeaders)
      } else {
        setError(json.error ?? 'Fout bij laden')
      }
    } catch {
      setError('Netwerkfout bij laden van producten')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProducts() }, [loadProducts])

  const mappedProducts = products.filter(p => p.tradeItemId)
  const unmappedProducts = products.filter(p => !p.tradeItemId)

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === mappedProducts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(mappedProducts.map(p => p.picqerProductId)))
    }
  }

  const handleSync = async () => {
    if (selected.size === 0) return
    setSyncing(true)
    setSyncResult(null)
    setError(null)

    try {
      const res = await fetch('/api/floriday/catalog-supply/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picqerProductIds: [...selected] }),
      })
      const json: SyncResponse = await res.json()
      setSyncResult(json)
    } catch {
      setError('Netwerkfout tijdens sync')
    } finally {
      setSyncing(false)
    }
  }

  // Zoek sync result detail per product
  const getProductSyncDetail = (pid: number): SyncDetail | undefined => {
    return syncResult?.details.find(d => d.picqerProductId === pid)
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Catalogus Supply (6 weken)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Multi-week voorraad syncen naar Floriday via bulk PUT
          </p>
        </div>
        <button
          onClick={loadProducts}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {/* Stats */}
      {!loading && products.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs mb-0.5">
              <Package className="w-3.5 h-3.5" /> Totaal
            </div>
            <p className="text-lg font-bold">{products.length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-emerald-600 text-xs mb-0.5">
              <Link2 className="w-3.5 h-3.5" /> Gemapt
            </div>
            <p className="text-lg font-bold text-emerald-600">{mappedProducts.length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-amber-600 text-xs mb-0.5">
              <Link2Off className="w-3.5 h-3.5" /> Niet gemapt
            </div>
            <p className="text-lg font-bold text-amber-600">{unmappedProducts.length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-1.5 text-blue-600 text-xs mb-0.5">
              <CheckCircle className="w-3.5 h-3.5" /> Geselecteerd
            </div>
            <p className="text-lg font-bold text-blue-600">{selected.size}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Producten laden...</div>
      ) : products.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Geen producten gevonden met tags Kunstplant, Floriday of Floriday product.
        </div>
      ) : (
        <>
          {/* Action bar */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing || selected.size === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {syncing ? 'Synchroniseren...' : `Geselecteerde syncen (${selected.size})`}
            </button>
            <button
              onClick={selectAll}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {selected.size === mappedProducts.length ? 'Niets selecteren' : 'Alles selecteren'}
            </button>
          </div>

          {/* Table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.size === mappedProducts.length && mappedProducts.length > 0}
                        onChange={selectAll}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Product</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Code</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Alt. SKU</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trade Item</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Mapping</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">VBN</th>
                    {weekHeaders.map(wh => (
                      <th key={wh} className="text-center px-2 py-2 font-medium text-muted-foreground text-xs">
                        {wh.replace(/^\d{4}-/, '')}
                      </th>
                    ))}
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {products.map((product) => {
                    const isMapped = !!product.tradeItemId
                    const syncDetail = getProductSyncDetail(product.picqerProductId)

                    return (
                      <tr
                        key={product.picqerProductId}
                        className={`transition-colors ${isMapped ? 'hover:bg-muted/30' : 'bg-muted/20 opacity-60'}`}
                      >
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selected.has(product.picqerProductId)}
                            onChange={() => toggleSelect(product.picqerProductId)}
                            disabled={!isMapped}
                            className="rounded border-gray-300 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={product.name}>
                          {product.name}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                          {product.productcode}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono text-xs">
                          {product.altSku ?? <span className="text-muted-foreground/40">—</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {product.tradeItemId ? (
                            <span title={product.tradeItemId} className="cursor-help">
                              {product.tradeItemId.slice(0, 8)}…
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isMapped ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                              <CheckCircle className="w-3 h-3" />
                              gemapt
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              <XCircle className="w-3 h-3" />
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-xs">
                          {product.vbnCode ? (
                            <span className="text-muted-foreground">{product.vbnCode}</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                        {weekHeaders.map((wh, idx) => {
                          const weekDetail = syncDetail?.weekResults[idx]
                          return (
                            <td key={wh} className="px-2 py-2 text-center">
                              {weekDetail ? (
                                <WeekBadge detail={weekDetail} />
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-center">
                          {syncDetail ? (
                            syncDetail.success ? (
                              <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {syncDetail.weekResults.filter(w => w.action === 'bulk_put').length}/{weekHeaders.length}
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-xs text-red-600 font-medium cursor-help"
                                title={syncDetail.error ?? 'Sync fout'}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                {syncDetail.error ? 'Fout' : 'Deels'}
                              </span>
                            )
                          ) : product.lastSyncedAt ? (
                            <span className="text-xs text-muted-foreground" title={`Laatste sync: ${new Date(product.lastSyncedAt).toLocaleString('nl-NL')}`}>
                              {new Date(product.lastSyncedAt).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' })}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sync resultaten */}
          {syncResult && (
            <div className={`text-sm px-4 py-3 rounded-lg border ${
              syncResult.success
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              <p className="font-medium mb-1">
                {syncResult.success ? 'Synchronisatie voltooid' : 'Synchronisatie voltooid met waarschuwingen'}
              </p>
              <p className="text-xs">
                {syncResult.synced} gesynchroniseerd
                {syncResult.skipped > 0 && ` · ${syncResult.skipped} overgeslagen (geen mapping)`}
                {syncResult.errors > 0 && ` · ${syncResult.errors} fouten`}
                {syncResult.frozenWeeks.length > 0 && ` · Frozen: ${syncResult.frozenWeeks.join(', ')}`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
