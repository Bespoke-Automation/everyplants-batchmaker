'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, TrendingUp, Package, AlertTriangle } from 'lucide-react'

interface StockCacheItem {
  picqer_product_id: number
  productcode: string
  name: string
  bulk_pick_stock: number
  po_qty_this_week: number
  week_stock: number
  po_details: PoDetail[]
  synced_at: string
}

interface PoDetail {
  idpurchaseorder: number
  purchaseorderid: string
  delivery_date: string
  qty: number
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <AlertTriangle className="w-3 h-3" />
        Leeg
      </span>
    )
  }
  if (stock < 20) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        {stock} st.
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
      {stock} st.
    </span>
  )
}

export default function FloridayStock() {
  const [items, setItems] = useState<StockCacheItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadCache = useCallback(async () => {
    try {
      const res = await fetch('/api/floriday/sync-stock')
      const json = await res.json()
      if (json.success) {
        setItems(json.data)
        if (json.data.length > 0) {
          setLastSynced(json.data[0].synced_at)
        }
      }
    } catch {
      setError('Fout bij laden van stockgegevens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCache()
  }, [loadCache])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/floriday/sync-stock', { method: 'POST' })
      const json = await res.json()
      if (json.success) {
        await loadCache()
      } else {
        setError(json.error ?? 'Sync mislukt')
      }
    } catch {
      setError('Netwerkfout tijdens sync')
    } finally {
      setSyncing(false)
    }
  }

  const totalProducts = items.length
  const emptyProducts = items.filter(i => i.week_stock === 0).length
  const productsWithPO = items.filter(i => i.po_qty_this_week > 0).length

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Floriday Voorraad</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekstock = huidige voorraad (excl. PPS) + inkooporders deze week
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Bezig...' : 'Sync nu'}
        </button>
      </div>

      {/* Stats */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Package className="w-4 h-4" />
              Producten
            </div>
            <p className="text-2xl font-bold">{totalProducts}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="w-4 h-4" />
              Met PO deze week
            </div>
            <p className="text-2xl font-bold text-blue-600">{productsWithPO}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <AlertTriangle className="w-4 h-4" />
              Leeg (weekstock 0)
            </div>
            <p className="text-2xl font-bold text-red-600">{emptyProducts}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Last synced */}
      {lastSynced && (
        <p className="text-xs text-muted-foreground">
          Laatste sync:{' '}
          {new Date(lastSynced).toLocaleString('nl-NL', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Laden...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          Geen data — klik op &ldquo;Sync nu&rdquo; om de voorraad op te halen.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Product</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Code</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Huidig</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">PO deze week</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Weekstock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.picqer_product_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                    {item.productcode}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StockBadge stock={item.bulk_pick_stock} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.po_qty_this_week > 0 ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 cursor-help"
                        title={item.po_details
                          .map(p => `PO ${p.purchaseorderid}: ${p.qty} st. (${new Date(p.delivery_date).toLocaleDateString('nl-NL')})`)
                          .join('\n')}
                      >
                        +{item.po_qty_this_week} st.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <StockBadge stock={item.week_stock} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
