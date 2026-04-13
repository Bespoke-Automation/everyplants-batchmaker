'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Copy,
  Package,
} from 'lucide-react'
import type {
  LearnedPatternDetail,
  LearnedPatternStatus,
} from '@/lib/engine/insights'

const STATUS_META: Record<
  LearnedPatternStatus,
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  active: {
    label: 'Actief',
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  learning: {
    label: 'Leert',
    icon: Clock,
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  invalidated: {
    label: 'Gedeactiveerd',
    icon: XCircle,
    cls: 'bg-slate-50 text-slate-600 border-slate-200',
  },
}

export default function LearnedPatternDetailView({ id }: { id: string }) {
  const [data, setData] = useState<LearnedPatternDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/verpakking/insights/patterns/${id}`)
      if (res.status === 404) {
        setError('Patroon niet gevonden')
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
  }, [id])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const handleAction = async (
    action: 'invalidate' | 'reactivate',
    confirmMessage: string,
  ) => {
    if (!confirm(confirmMessage)) return
    try {
      const res = await fetch(`/api/verpakking/insights/patterns/${id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert(`Actie mislukt: ${err.error ?? res.statusText}`)
        return
      }
      await fetchDetail()
    } catch (err) {
      alert(`Actie mislukt: ${err instanceof Error ? err.message : 'Onbekende fout'}`)
    }
  }

  const handleCopyFingerprint = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.fingerprint)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures — not worth a banner
    }
  }

  if (loading) {
    return (
      <div
        className="max-w-5xl mx-auto py-12 text-center text-muted-foreground"
        aria-live="polite"
        aria-busy="true"
      >
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Patroon laden...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <Link
          href="/verpakkingsmodule/insights/patterns"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar patronen
        </Link>
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error ?? 'Onbekende fout'}</span>
        </div>
      </div>
    )
  }

  const statusMeta = STATUS_META[data.status]
  const StatusIcon = statusMeta.icon

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/verpakkingsmodule/insights/patterns"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar patronen
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold">
              {data.products.map((p, i) => (
                <span key={p.productcode}>
                  {i > 0 && <span className="text-muted-foreground"> + </span>}
                  <span>{p.quantity}× </span>
                  <span>{p.productName ?? p.productcode}</span>
                </span>
              ))}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${statusMeta.cls}`}
              >
                <StatusIcon className="w-3 h-3" />
                {statusMeta.label}
              </span>
              {data.isDrifting && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                  <AlertTriangle className="w-3 h-3" />
                  Kalft af
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Observaties" value={String(data.timesSeen)} />
        <StatCard
          label="Overrides"
          value={`${data.timesOverridden} (${(data.overrideRatio * 100).toFixed(0)}%)`}
          hintClass={
            data.overrideRatio > 0.3 ? 'text-red-700' : undefined
          }
        />
        <StatCard
          label="Geleerd sinds"
          value={
            data.promotedAt
              ? new Date(data.promotedAt).toLocaleDateString('nl-NL')
              : data.status === 'learning'
                ? 'nog niet'
                : '—'
          }
        />
        <StatCard
          label="Laatst gebruikt"
          value={new Date(data.lastSeenAt).toLocaleDateString('nl-NL')}
        />
      </div>

      {/* Fingerprint + copy */}
      <section className="border border-border rounded-lg bg-card p-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Fingerprint:</span>
          <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{data.fingerprint}</code>
          <button
            onClick={handleCopyFingerprint}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 ml-auto"
          >
            <Copy className="w-3 h-3" />
            {copied ? 'Gekopieerd!' : 'Kopieer'}
          </button>
        </div>
      </section>

      {/* Box pattern */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          Geleerd inpak-patroon
        </h2>
        {data.boxPattern.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen dozen in dit patroon.</p>
        ) : (
          <div className="space-y-3">
            {data.boxPattern.map((box, i) => (
              <div key={`${box.idpackaging}-${i}`} className="border border-border rounded p-3">
                <div className="font-medium text-sm">1× {box.packaging_name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Bevat:{' '}
                  {box.units.length === 0
                    ? '—'
                    : box.units.map((u, j) => (
                        <span key={`${u.name}-${j}`}>
                          {j > 0 && ', '}
                          {u.qty}× {u.name}
                        </span>
                      ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Invalidation reason */}
      {data.invalidationReason && (
        <section className="border border-slate-200 bg-slate-50 rounded-lg p-4">
          <div className="flex items-start gap-2 text-sm text-slate-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">Deactivatie reden</p>
              <p className="text-xs mt-0.5">{data.invalidationReason}</p>
              {data.invalidatedAt && (
                <p className="text-xs text-slate-500 mt-1">
                  {new Date(data.invalidatedAt).toLocaleString('nl-NL')}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Recent sessions */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Recente sessies die dit patroon gebruikten</h2>
        {data.recentSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Geen sessies gevonden. Dit patroon is waarschijnlijk vóór de engine-link is gelegd
            geleerd, of wordt nog niet gebruikt in adviezen.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-border">
                <tr className="text-muted-foreground">
                  <th className="text-left py-2 font-medium">Datum</th>
                  <th className="text-left py-2 font-medium">Medewerker</th>
                  <th className="text-left py-2 font-medium">Picklist</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSessions.map((s) => (
                  <tr key={s.session_id || `${s.picklist_id}`} className="border-b border-border last:border-0">
                    <td className="py-2 text-muted-foreground">
                      {s.completed_at
                        ? new Date(s.completed_at).toLocaleDateString('nl-NL')
                        : '—'}
                    </td>
                    <td className="py-2">{s.assigned_to_name ?? '—'}</td>
                    <td className="py-2 font-mono">
                      {s.picklist_id !== null ? `#${s.picklist_id}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Actions */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Acties</h2>
        <div className="flex flex-wrap items-center gap-2">
          {data.status !== 'invalidated' ? (
            <button
              onClick={() =>
                handleAction(
                  'invalidate',
                  `Deactiveer dit patroon?\n\nDe engine zal het niet meer adviseren. Je kunt het later opnieuw activeren.`,
                )
              }
              className="px-3 py-2 text-sm border border-red-200 bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
            >
              Deactiveer patroon
            </button>
          ) : (
            <button
              onClick={() =>
                handleAction(
                  'reactivate',
                  `Activeer dit patroon opnieuw?\n\nHet patroon wordt weer beschikbaar voor het engine-advies.`,
                )
              }
              className="px-3 py-2 text-sm border border-emerald-200 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 transition-colors"
            >
              Heractiveer patroon
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  hintClass,
}: {
  label: string
  value: string
  hintClass?: string
}) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${hintClass ?? ''}`}>{value}</div>
    </div>
  )
}
