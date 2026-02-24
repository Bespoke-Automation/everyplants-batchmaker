'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  SkipForward,
  Clock,
  Play,
  Database,
  Ban,
} from 'lucide-react'

interface SyncState {
  resource_name: string
  last_processed_sequence: number
  max_sequence: number
  last_sync_completed_at: string | null
  last_sync_error: string | null
  records_processed_last_run: number | null
}

interface SyncLog {
  id: number
  action: string
  status: string
  duration_ms: number | null
  payload: Record<string, unknown>
  created_at: string
}

interface DashboardData {
  orders: unknown[]
  counts: { created: number; failed: number; skipped: number; cancelled: number; total: number }
  syncStates: SyncState[]
  recentLogs: SyncLog[]
}

export default function FloridayDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null)
  const [floridayEnv, setFloridayEnv] = useState<'staging' | 'live' | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/floriday/orders?limit=5')
      if (res.ok) {
        setData(await res.json())
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    fetch('/api/floriday/env')
      .then(r => r.json())
      .then(d => setFloridayEnv(d.env))
      .catch(() => {})
  }, [fetchData])

  const triggerSync = async (action: string) => {
    setSyncing(action)
    setSyncResult(null)
    try {
      const res = await fetch('/api/floriday/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const result = await res.json()
      setSyncResult({ success: result.success, message: result.message || result.error })
      await fetchData()
    } catch (err) {
      setSyncResult({ success: false, message: 'Sync request mislukt' })
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const counts = data?.counts || { created: 0, failed: 0, skipped: 0, cancelled: 0, total: 0 }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">Floriday Dashboard</h2>
          {floridayEnv && (
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                floridayEnv === 'live'
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
            >
              {floridayEnv === 'live' ? '●' : '⚠'} {floridayEnv === 'live' ? 'Live' : 'Staging'}
            </span>
          )}
        </div>
        <button
          onClick={() => fetchData()}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Vernieuwen
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <KpiCard
          label="Totaal"
          value={counts.total}
          icon={<Database className="w-5 h-5 text-blue-500" />}
          color="blue"
        />
        <KpiCard
          label="Aangemaakt"
          value={counts.created}
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          color="emerald"
        />
        <KpiCard
          label="Mislukt"
          value={counts.failed}
          icon={<XCircle className="w-5 h-5 text-red-500" />}
          color="red"
        />
        <KpiCard
          label="Overgeslagen"
          value={counts.skipped}
          icon={<SkipForward className="w-5 h-5 text-amber-500" />}
          color="amber"
        />
        <KpiCard
          label="Geannuleerd"
          value={counts.cancelled}
          icon={<Ban className="w-5 h-5 text-gray-500" />}
          color="gray"
        />
      </div>

      {/* Sync Actions */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold mb-3">Sync Acties</h3>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => triggerSync('full-sync')}
            disabled={syncing !== null}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {syncing === 'full-sync' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Orders Syncen
          </button>
          <button
            onClick={() => triggerSync('warehouse-cache')}
            disabled={syncing !== null}
            className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {syncing === 'warehouse-cache' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Database className="w-4 h-4" />
            )}
            Warehouse Cache Verversen
          </button>
        </div>
        {syncResult && (
          <div
            className={`mt-3 p-3 rounded-md text-sm ${
              syncResult.success
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}
          >
            {syncResult.message}
          </div>
        )}
      </div>

      {/* Sync State */}
      <div className="border border-border rounded-lg bg-card p-4">
        <h3 className="font-semibold mb-3">Sync Status</h3>
        {data?.syncStates && data.syncStates.length > 0 ? (
          <div className="space-y-3">
            {data.syncStates.map((state) => (
              <div key={state.resource_name} className="flex items-center justify-between p-3 bg-muted/50 rounded-md">
                <div>
                  <p className="font-medium text-sm">{state.resource_name}</p>
                  <p className="text-xs text-muted-foreground">
                    Sequence: {state.last_processed_sequence}
                    {state.max_sequence ? ` / ${state.max_sequence}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  {state.last_sync_completed_at ? (
                    <p className="text-xs text-muted-foreground">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {new Date(state.last_sync_completed_at).toLocaleString('nl-NL')}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nog niet gesync&apos;d</p>
                  )}
                  {state.last_sync_error && (
                    <p className="text-xs text-red-500 mt-0.5">{state.last_sync_error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Geen sync state gevonden. Start een sync om te beginnen.</p>
        )}
      </div>

      {/* Recent Logs */}
      <div className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recente Sync Logs</h3>
          <a href="/floriday/logs" className="text-sm text-emerald-600 hover:underline">
            Alle logs bekijken
          </a>
        </div>
        {data?.recentLogs && data.recentLogs.length > 0 ? (
          <div className="space-y-2">
            {data.recentLogs.slice(0, 5).map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between p-2 rounded-md text-sm border border-border"
              >
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                  )}
                  <span className="font-medium">{log.action}</span>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-xs">
                  {log.duration_ms && <span>{log.duration_ms}ms</span>}
                  <span>{new Date(log.created_at).toLocaleString('nl-NL')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Geen logs beschikbaar.</p>
        )}
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  icon,
  color,
}: {
  label: string
  value: number
  icon: React.ReactNode
  color: string
}) {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {icon}
      </div>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )
}
