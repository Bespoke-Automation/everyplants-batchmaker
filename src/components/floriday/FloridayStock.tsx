'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, TrendingUp, Package, AlertTriangle, Send, CheckCircle, Search } from 'lucide-react'

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

interface MappedProduct {
  picqer_product_id: number
  picqer_product_code: string
  floriday_trade_item_name: string
  last_stock_sync_at: string | null
}

interface PushResult {
  success: boolean
  batchesCreated: number
  bulkPickStock: number
  poQtyThisWeek: number
  weekStock: number
  error?: string
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
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        {stock} st.
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
      {stock} st.
    </span>
  )
}

function PushButton({
  productId,
  disabled,
  pushing,
  pushed,
  onPush,
}: {
  productId: number
  disabled?: boolean
  pushing: boolean
  pushed: boolean
  onPush: (id: number) => void
}) {
  if (pushed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <CheckCircle className="w-3.5 h-3.5" />
        Gepusht
      </span>
    )
  }
  return (
    <button
      onClick={() => onPush(productId)}
      disabled={pushing || disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white transition-colors"
    >
      {pushing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
      Naar Floriday
    </button>
  )
}

// ─── Sync Trade Items Button ──────────────────────────────────

function SyncTradeItemsButton() {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ upserted?: number; error?: string } | null>(null)

  const handleSync = async () => {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch('/api/floriday/sync-trade-items', { method: 'POST' })
      const json = await res.json()
      setResult(json.success ? { upserted: json.upserted } : { error: json.error })
    } catch {
      setResult({ error: 'Netwerkfout' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={syncing}
        title="Sync Floriday catalogus voor auto-match van ongemapte producten"
        className="flex items-center gap-2 px-4 py-2 bg-muted hover:bg-muted/80 disabled:opacity-50 text-foreground text-sm font-medium rounded-lg border border-border transition-colors"
      >
        <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
        {syncing ? 'Bezig...' : 'Sync trade items'}
      </button>
      {result && (
        <div className={`absolute right-0 top-full mt-1 z-10 text-xs px-3 py-1.5 rounded-lg whitespace-nowrap shadow-md ${result.error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          {result.error ?? `${result.upserted} trade items bijgewerkt`}
        </div>
      )}
    </div>
  )
}

// ─── Single Product Push Panel ────────────────────────────────

function SingleProductPanel() {
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MappedProduct | null>(null)
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState<PushResult | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    fetch('/api/floriday/mapped-products')
      .then(r => r.json())
      .then(j => { if (j.success) setMappedProducts(j.data) })
  }, [])

  const filtered = mappedProducts.filter(p =>
    p.floriday_trade_item_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.picqer_product_code?.toLowerCase().includes(search.toLowerCase())
  ).slice(0, 8)

  const handleSelect = (product: MappedProduct) => {
    setSelected(product)
    setSearch(product.floriday_trade_item_name ?? product.picqer_product_code)
    setShowDropdown(false)
    setResult(null)
  }

  const handlePush = async () => {
    if (!selected) return
    setPushing(true)
    setResult(null)
    try {
      const res = await fetch('/api/floriday/push-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picqerProductId: selected.picqer_product_id }),
      })
      const json: PushResult = await res.json()
      setResult(json)
    } catch {
      setResult({ success: false, batchesCreated: 0, bulkPickStock: 0, poQtyThisWeek: 0, weekStock: 0, error: 'Netwerkfout' })
    } finally {
      setPushing(false)
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <h2 className="text-sm font-semibold">Direct 1 product syncen naar Floriday</h2>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            placeholder="Zoek op productnaam of code..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500"
            onChange={e => {
              setSearch(e.target.value)
              setSelected(null)
              setResult(null)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          />
          {showDropdown && search.length > 0 && filtered.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
              {filtered.map(p => (
                <li key={p.picqer_product_id}>
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                    onMouseDown={() => handleSelect(p)}
                  >
                    <span className="font-medium">{p.floriday_trade_item_name}</span>
                    <span className="text-muted-foreground ml-2 text-xs">{p.picqer_product_code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          onClick={handlePush}
          disabled={!selected || pushing}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {pushing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {pushing ? 'Bezig...' : 'Sync → Floriday'}
        </button>
      </div>

      {result && (
        <div className={`text-sm px-3 py-2 rounded-lg ${result.success ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {result.success ? (
            <>
              <span className="font-medium">Geslaagd</span> — {result.batchesCreated} batch(es) aangemaakt op Floriday.
              <span className="ml-2 text-xs text-emerald-600">
                Huidig: {result.bulkPickStock} st. · PO&apos;s: +{result.poQtyThisWeek} st. · Week: {result.weekStock} st.
              </span>
            </>
          ) : (
            result.error
          )}
        </div>
      )}
    </div>
  )
}

// ─── Hoofdcomponent ───────────────────────────────────────────

export default function FloridayStock() {
  const [items, setItems] = useState<StockCacheItem[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pushingId, setPushingId] = useState<number | null>(null)
  const [pushedIds, setPushedIds] = useState<Set<number>>(new Set())

  const loadCache = useCallback(async () => {
    try {
      const res = await fetch('/api/floriday/sync-stock')
      const json = await res.json()
      if (json.success) {
        setItems(json.data)
        if (json.data.length > 0) setLastSynced(json.data[0].synced_at)
      }
    } catch {
      setError('Fout bij laden van stockgegevens')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCache() }, [loadCache])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/floriday/sync-stock', { method: 'POST' })
      const json = await res.json()
      if (json.success) await loadCache()
      else setError(json.error ?? 'Sync mislukt')
    } catch {
      setError('Netwerkfout tijdens sync')
    } finally {
      setSyncing(false)
    }
  }

  const handlePushBatch = async (productId: number) => {
    setPushingId(productId)
    setError(null)
    try {
      const res = await fetch('/api/floriday/push-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picqerProductId: productId }),
      })
      const json = await res.json()
      if (json.success) {
        setPushedIds(prev => new Set(prev).add(productId))
      } else {
        setError(`${json.error}`)
      }
    } catch {
      setError('Netwerkfout bij pushen')
    } finally {
      setPushingId(null)
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
        <div className="flex gap-2">
          <SyncTradeItemsButton />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Bezig...' : 'Voorraad syncen'}
          </button>
        </div>
      </div>

      {/* Single product panel */}
      <SingleProductPanel />

      {/* Stats */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Package className="w-4 h-4" /> Producten
            </div>
            <p className="text-2xl font-bold">{totalProducts}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <TrendingUp className="w-4 h-4" /> Met PO deze week
            </div>
            <p className="text-2xl font-bold text-blue-600">{productsWithPO}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <AlertTriangle className="w-4 h-4" /> Leeg (weekstock 0)
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

      {lastSynced && (
        <p className="text-xs text-muted-foreground">
          Laatste cache sync:{' '}
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
          Geen cache — klik &ldquo;Alle producten syncen&rdquo; voor een overzicht, of gebruik het zoekveld hierboven voor één product.
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
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.picqer_product_id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{item.name}</td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{item.productcode}</td>
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
                  <td className="px-4 py-3 text-right">
                    <PushButton
                      productId={item.picqer_product_id}
                      pushing={pushingId === item.picqer_product_id}
                      pushed={pushedIds.has(item.picqer_product_id)}
                      onPush={handlePushBatch}
                    />
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
