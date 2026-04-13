'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Users,
} from 'lucide-react'
import type { WorkerComplianceRow } from '@/lib/engine/insights'

export default function WorkerCompliance() {
  const [rows, setRows] = useState<WorkerComplianceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchWorkers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/verpakking/insights/workers')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkers()
  }, [fetchWorkers])

  // Compute average for the bar
  const avgFollowRate =
    rows.length === 0
      ? 0
      : rows.reduce((sum, r) => sum + (r.followRate ?? 0), 0) /
        rows.filter((r) => r.followRate !== null).length

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/verpakkingsmodule/insights"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" />
            Terug naar Insights
          </Link>
          <h1 className="text-2xl font-semibold mt-1 flex items-center gap-2">
            <Users className="w-6 h-6 text-primary" />
            Medewerker prestaties
          </h1>
          <p className="text-sm text-muted-foreground">
            Follow-rate per medewerker op basis van engine-advies. Gemiddelde:{' '}
            <span className="font-medium">{avgFollowRate.toFixed(0)}%</span>
          </p>
        </div>
        <button
          onClick={fetchWorkers}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div
          className="text-center py-12 text-muted-foreground"
          aria-live="polite"
          aria-busy="true"
        >
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          Laden...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          Geen voltooide sessies gevonden.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link
              key={row.workerId}
              href={`/verpakkingsmodule/insights/workers/${row.workerId}`}
              className="flex items-center gap-4 p-4 border border-border rounded-lg bg-card hover:border-primary hover:shadow-sm transition-all group"
            >
              {/* Avatar placeholder */}
              <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold text-muted-foreground">
                {row.workerName
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>

              {/* Name + stats */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium group-hover:text-primary">
                    {row.workerName}
                  </span>
                  {row.needsAttention && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                      <AlertTriangle className="w-3 h-3" />
                      Aandacht nodig
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {row.totalSessions} sessies · {row.sessionsWithOutcome} met outcome
                </div>
              </div>

              {/* Outcome bar */}
              <div className="w-48 flex-shrink-0 hidden md:block">
                {row.sessionsWithOutcome > 0 && (
                  <div className="flex items-center gap-1 h-4 rounded overflow-hidden bg-muted text-[9px]">
                    {row.followed > 0 && (
                      <div
                        className="bg-emerald-500 text-white flex items-center justify-center h-full"
                        style={{ flex: row.followed }}
                        title={`Gevolgd: ${row.followed}`}
                      >
                        {row.followed}
                      </div>
                    )}
                    {row.modified > 0 && (
                      <div
                        className="bg-amber-500 text-white flex items-center justify-center h-full"
                        style={{ flex: row.modified }}
                        title={`Gewijzigd: ${row.modified}`}
                      >
                        {row.modified}
                      </div>
                    )}
                    {row.ignored > 0 && (
                      <div
                        className="bg-red-500 text-white flex items-center justify-center h-full"
                        style={{ flex: row.ignored }}
                        title={`Genegeerd: ${row.ignored}`}
                      >
                        {row.ignored}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Follow rate + vs average */}
              <div className="text-right flex-shrink-0 w-24">
                <div
                  className={`text-lg font-semibold ${
                    row.followRate === null
                      ? 'text-muted-foreground'
                      : row.followRate >= avgFollowRate
                        ? 'text-emerald-700'
                        : 'text-red-700'
                  }`}
                >
                  {row.followRate === null ? '—' : `${row.followRate.toFixed(0)}%`}
                </div>
                {row.vsAverage !== 0 && row.followRate !== null && (
                  <div
                    className={`text-xs ${row.vsAverage >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                  >
                    {row.vsAverage >= 0 ? '+' : ''}
                    {row.vsAverage.toFixed(0)}pp vs gem.
                  </div>
                )}
              </div>

              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> Gevolgd
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-amber-500 rounded-sm" /> Gewijzigd
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-sm" /> Genegeerd
        </span>
      </div>
    </div>
  )
}
