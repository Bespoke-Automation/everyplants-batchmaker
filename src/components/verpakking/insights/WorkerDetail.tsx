'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Edit,
} from 'lucide-react'
import type {
  WorkerDetailData,
  AdviceOutcome,
  AdviceConfidence,
} from '@/lib/engine/insights'

export default function WorkerDetail({ workerId }: { workerId: number }) {
  const [data, setData] = useState<WorkerDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/verpakking/insights/workers/${workerId}`)
      if (res.status === 404) {
        setError('Geen sessies gevonden voor deze medewerker')
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [workerId])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  if (loading) {
    return (
      <div
        className="max-w-5xl mx-auto py-12 text-center text-muted-foreground"
        aria-live="polite"
        aria-busy="true"
      >
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Laden...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <Link
          href="/verpakkingsmodule/insights/workers"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar overzicht
        </Link>
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error ?? 'Onbekende fout'}</span>
        </div>
      </div>
    )
  }

  const { worker, recentSessions, weeklyTrend } = data

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/verpakkingsmodule/insights/workers"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar overzicht
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center text-lg font-semibold text-muted-foreground">
            {worker.workerName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{worker.workerName}</h1>
            {worker.needsAttention && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="w-3 h-3" />
                Follow-rate onder gemiddelde
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Sessies" value={String(worker.totalSessions)} />
        <StatCard
          label="Follow-rate"
          value={worker.followRate === null ? '—' : `${worker.followRate.toFixed(0)}%`}
          color={
            worker.followRate === null
              ? undefined
              : worker.followRate >= 20
                ? 'emerald'
                : worker.followRate >= 10
                  ? 'amber'
                  : 'red'
          }
        />
        <StatCard
          label="vs Gemiddelde"
          value={`${worker.vsAverage >= 0 ? '+' : ''}${worker.vsAverage.toFixed(0)}pp`}
          color={worker.vsAverage >= 0 ? 'emerald' : 'red'}
        />
        <StatCard label="Met outcome" value={`${worker.sessionsWithOutcome} / ${worker.totalSessions}`} />
      </div>

      {/* Outcome breakdown */}
      {worker.sessionsWithOutcome > 0 && (
        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Outcome verdeling</h2>
          <div className="flex items-center gap-1 h-6 rounded overflow-hidden bg-muted text-xs">
            {worker.followed > 0 && (
              <div
                className="bg-emerald-500 text-white flex items-center justify-center h-full"
                style={{ flex: worker.followed }}
              >
                {worker.followed}
              </div>
            )}
            {worker.modified > 0 && (
              <div
                className="bg-amber-500 text-white flex items-center justify-center h-full"
                style={{ flex: worker.modified }}
              >
                {worker.modified}
              </div>
            )}
            {worker.ignored > 0 && (
              <div
                className="bg-red-500 text-white flex items-center justify-center h-full"
                style={{ flex: worker.ignored }}
              >
                {worker.ignored}
              </div>
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              Gevolgd: {worker.followed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-amber-500 rounded-full" />
              Gewijzigd: {worker.modified}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              Genegeerd: {worker.ignored}
            </span>
          </div>
        </section>
      )}

      {/* Weekly trend */}
      {weeklyTrend.length > 0 && (
        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Follow-rate trend (laatste 12 weken)</h2>
          <div className="flex items-end gap-1 h-24">
            {weeklyTrend.map((w) => (
              <div
                key={w.week}
                className="flex-1 flex flex-col items-center justify-end"
                title={`${w.week}: ${w.followRate.toFixed(0)}% (${w.followed}/${w.total})`}
              >
                <div
                  className={`w-full rounded-t ${w.total === 0 ? 'bg-muted' : 'bg-emerald-500'}`}
                  style={{ height: `${Math.max(4, w.followRate)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{weeklyTrend[0]?.week ?? ''}</span>
            <span>{weeklyTrend[weeklyTrend.length - 1]?.week ?? ''}</span>
          </div>
        </section>
      )}

      {/* Recent sessions */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Recente sessies</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border">
              <tr className="text-muted-foreground">
                <th className="text-left py-2 font-medium">Datum</th>
                <th className="text-left py-2 font-medium">Picklist</th>
                <th className="text-left py-2 font-medium">Confidence</th>
                <th className="text-left py-2 font-medium">Advies → Werkelijk</th>
                <th className="text-left py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recentSessions.map((s) => (
                <tr key={s.sessionId} className="border-b border-border last:border-0">
                  <td className="py-2 text-muted-foreground whitespace-nowrap">
                    {s.completedAt
                      ? new Date(s.completedAt).toLocaleDateString('nl-NL')
                      : '—'}
                  </td>
                  <td className="py-2 font-mono">#{s.picklistId}</td>
                  <td className="py-2">
                    {s.confidence ? (
                      <ConfidenceBadge confidence={s.confidence} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2">
                    <div className="text-muted-foreground">
                      {s.adviceBoxes.length > 0 ? s.adviceBoxes.join(', ') : '—'}
                    </div>
                    {s.actualBoxes.length > 0 && (
                      <div className="text-foreground">→ {s.actualBoxes.join(', ')}</div>
                    )}
                  </td>
                  <td className="py-2">
                    <OutcomeBadge outcome={s.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: 'emerald' | 'amber' | 'red'
}) {
  const colorClass = color
    ? { emerald: 'text-emerald-700', amber: 'text-amber-700', red: 'text-red-700' }[color]
    : ''

  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${colorClass}`}>{value}</div>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: AdviceConfidence }) {
  const map = {
    full_match: { label: 'full', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    partial_match: { label: 'partial', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    no_match: { label: 'none', cls: 'bg-red-50 text-red-700 border-red-200' },
  } as const
  const { label, cls } = map[confidence]
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${cls}`}>
      {label}
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome: AdviceOutcome | null }) {
  if (outcome === null) {
    return <span className="text-muted-foreground text-[10px]">—</span>
  }
  const map = {
    followed: {
      icon: <CheckCircle2 className="w-3 h-3" />,
      label: 'gevolgd',
      cls: 'text-emerald-700',
    },
    modified: { icon: <Edit className="w-3 h-3" />, label: 'gewijzigd', cls: 'text-amber-700' },
    ignored: { icon: <XCircle className="w-3 h-3" />, label: 'genegeerd', cls: 'text-red-700' },
    no_advice: { icon: null, label: 'geen advies', cls: 'text-slate-600' },
  } as const
  const { icon, label, cls } = map[outcome]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${cls}`}>
      {icon}
      {label}
    </span>
  )
}
