'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle2, XCircle } from 'lucide-react'

interface SyncLog {
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

export default function FloridaySyncLog() {
  const [logs, setLogs] = useState<SyncLog[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/floriday/orders?limit=1')
      if (res.ok) {
        const data = await res.json()
        setLogs(data.recentLogs || [])
      }
    } catch (err) {
      console.error('Logs fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

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

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : logs.length === 0 ? (
        <div className="border border-border rounded-lg bg-card p-8 text-center">
          <p className="text-muted-foreground">Geen sync logs beschikbaar. Start een sync om logs te genereren.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="border border-border rounded-lg bg-card p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {log.status === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-sm">{log.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.source_system} → {log.target_system}
                    </p>
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{new Date(log.created_at).toLocaleString('nl-NL')}</p>
                  {log.duration_ms && <p>{log.duration_ms}ms</p>}
                </div>
              </div>

              {log.payload && Object.keys(log.payload).length > 0 && (
                <div className="mt-3 bg-muted/50 rounded-md p-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {Object.entries(log.payload).map(([key, value]) => (
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
