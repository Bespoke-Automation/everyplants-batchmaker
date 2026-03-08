'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────

interface OrderSyncLog {
  id: number
  service: string | null
  action: string
  source_system: string | null
  target_system: string | null
  status: string
  duration_ms: number | null
  error_message: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

interface StockSyncLogEntry {
  id: number
  trigger_type: string
  products_synced: number
  products_skipped: number
  products_errored: number
  drift_detected: number
  duration_ms: number | null
  details: Record<string, unknown> | null
  created_at: string
}

interface UnifiedLogEntry {
  id: string
  source: 'order' | 'stock' | 'catalog'
  action: string
  status: string
  duration_ms: number | null
  details: Record<string, unknown> | null
  error_message: string | null
  created_at: string
}

type FilterType = 'all' | 'order' | 'stock' | 'catalog'

// ─── Helpers ─────────────────────────────────────────────────

function normalizeOrderLog(log: OrderSyncLog): UnifiedLogEntry {
  return {
    id: `order-${log.id}`,
    source: 'order',
    action: log.action,
    status: log.status,
    duration_ms: log.duration_ms,
    details: log.payload,
    error_message: log.error_message,
    created_at: log.created_at,
  }
}

const TRIGGER_LABELS: Record<string, string> = {
  webhook: 'Webhook stock sync',
  cron_hourly: 'Uurlijkse stock sync',
  reconciliation: 'Stock reconciliation',
  daily_catalog_sync: 'Dagelijkse catalogus sync',
}

function normalizeStockLog(log: StockSyncLogEntry): UnifiedLogEntry {
  const isCatalog = log.trigger_type === 'daily_catalog_sync'

  const catalogDetails = log.details as { productIndex?: { synced?: number }; tradeItems?: { upserted?: number }; autoMap?: { newMappings?: number; noMatch?: number; alreadyMapped?: number } } | null

  const details: Record<string, unknown> = isCatalog
    ? {
        nieuw_gemapt: log.products_synced,
        geen_match: catalogDetails?.autoMap?.noMatch ?? 0,
        al_gemapt: catalogDetails?.autoMap?.alreadyMapped ?? 0,
        product_index: catalogDetails?.productIndex?.synced ?? 0,
        trade_items: catalogDetails?.tradeItems?.upserted ?? 0,
      }
    : {
        products_synced: log.products_synced,
        products_skipped: log.products_skipped,
        products_errored: log.products_errored,
        ...(log.drift_detected > 0 ? { drift_detected: log.drift_detected } : {}),
      }

  return {
    id: `${isCatalog ? 'catalog' : 'stock'}-${log.id}`,
    source: isCatalog ? 'catalog' : 'stock',
    action: TRIGGER_LABELS[log.trigger_type] || log.trigger_type,
    status: log.products_errored > 0 ? 'error' : 'success',
    duration_ms: log.duration_ms,
    details,
    error_message: null,
    created_at: log.created_at,
  }
}

function SourceBadge({ source }: { source: 'order' | 'stock' | 'catalog' }) {
  if (source === 'order') {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Order</span>
  }
  if (source === 'catalog') {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">Catalog</span>
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700">Stock</span>
}

// ─── Component ───────────────────────────────────────────────

export default function FloridaySyncLog() {
  const [logs, setLogs] = useState<UnifiedLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const [orderRes, stockRes] = await Promise.all([
        fetch('/api/floriday/orders?limit=1'),
        fetch('/api/floriday/stock-sync-status'),
      ])

      const unified: UnifiedLogEntry[] = []

      if (orderRes.ok) {
        const orderData = await orderRes.json()
        const orderLogs: OrderSyncLog[] = orderData.recentLogs || []
        unified.push(...orderLogs.map(normalizeOrderLog))
      }

      if (stockRes.ok) {
        const stockData = await stockRes.json()
        const stockLogs: StockSyncLogEntry[] = stockData.recentRuns || []
        unified.push(...stockLogs.map(normalizeStockLog))
      }

      // Chronologisch sorteren (nieuwste eerst)
      unified.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      setLogs(unified)
    } catch (err) {
      console.error('Logs fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const filteredLogs = filter === 'all' ? logs : logs.filter(l => l.source === filter)

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'order', label: 'Order sync' },
    { key: 'stock', label: 'Stock sync' },
    { key: 'catalog', label: 'Catalog sync' },
  ]

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Sync Log</h2>
        <button
          onClick={() => fetchLogs()}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {/* Filter knoppen */}
      <div className="flex gap-1">
        {filterButtons.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
              filter === key
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-8 text-center">
          <p className="text-muted-foreground">
            {filter === 'all'
              ? 'Geen sync logs beschikbaar. Start een sync om logs te genereren.'
              : `Geen ${filter === 'order' ? 'order' : filter === 'stock' ? 'stock' : 'catalog'} sync logs gevonden.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLogs.map((log) => (
            <div
              key={log.id}
              className="border border-border rounded-lg bg-card p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : log.status === 'error' ? (
                    <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
                  )}
                  <SourceBadge source={log.source} />
                  <div>
                    <p className="font-medium text-sm">{log.action}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{new Date(log.created_at).toLocaleString('nl-NL')}</p>
                  {log.duration_ms && <p>{log.duration_ms}ms</p>}
                </div>
              </div>

              {log.details && Object.keys(log.details).length > 0 && (
                <div className="mt-3 bg-muted/50 rounded-md p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {Object.entries(log.details).map(([key, value]) => (
                      <div key={key}>
                        <p className="text-muted-foreground">{key}</p>
                        <p className="font-medium">{String(value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {log.error_message && (
                <div className="mt-2 text-xs text-red-600 font-mono bg-red-50 p-2 rounded">
                  {log.error_message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
