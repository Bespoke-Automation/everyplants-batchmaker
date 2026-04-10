'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  CheckCircle2,
  Info,
  Library,
  Sparkles,
} from 'lucide-react'
import type { ComplianceTrendPoint, OverviewResponse } from '@/lib/engine/insights'
import { INSIGHTS_WINDOW_DAYS } from '@/lib/engine/insights'

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`
}

function trendDelta(points: ComplianceTrendPoint[]): {
  delta: number | null
  direction: 'up' | 'down' | 'flat'
} {
  if (points.length < 2) return { delta: null, direction: 'flat' }
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  const delta = last.followRate - prev.followRate
  return {
    delta,
    direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
  }
}

export default function InsightsOverview() {
  const [data, setData] = useState<OverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/verpakking/insights/overview')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as OverviewResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  // Initial load state — no data yet
  if (loading && !data) {
    return (
      <div
        className="max-w-6xl mx-auto py-12 text-center text-muted-foreground"
        aria-live="polite"
        aria-busy="true"
      >
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Insights laden...
      </div>
    )
  }

  // Cold error state — no data and the fetch failed
  if (error && !data) {
    return (
      <div className="max-w-6xl mx-auto py-8">
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Kon insights niet laden</p>
            <p className="text-xs mt-1">{error}</p>
            <button
              onClick={fetchOverview}
              className="mt-2 text-xs underline hover:no-underline"
            >
              Opnieuw proberen
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { gap, funnel, trend } = data
  const trendInfo = trendDelta(trend)

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            Engine Insights
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Overzicht van de verpakkingsadvies-engine en hoe het advies wordt opgevolgd.
          </p>
        </div>
        <button
          onClick={fetchOverview}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {/* Refresh error banner (inline, only when we still have data to show) */}
      {error && data && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Vernieuwen mislukt</p>
            <p className="text-xs mt-1">
              {error}. De cijfers hieronder kunnen verouderd zijn.
            </p>
          </div>
          <button
            onClick={fetchOverview}
            className="text-xs underline hover:no-underline flex-shrink-0"
          >
            Opnieuw proberen
          </button>
        </div>
      )}

      {/* Data quality notice */}
      {gap.compliance.unresolved > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <Info className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">
              {gap.compliance.unresolved} van {gap.total} advies-records hebben geen outcome
            </p>
            <p className="text-xs mt-1">
              Voor deze records is niet vastgelegd of het advies gevolgd, gewijzigd of genegeerd is.
              De compliance-meter gebruikt alleen de {gap.compliance.resolved} resolved records. Dit
              is een bekende beperking in de feedback-tracking die apart wordt onderzocht.
            </p>
          </div>
        </div>
      )}

      {/* Gap Meter */}
      <section className="border border-border rounded-lg bg-card p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-semibold">Gap to 100%</h2>
          <div className="text-sm text-muted-foreground">
            Gemeten over {gap.total} adviezen
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-sm font-medium">Perfect orders</span>
            <span className="text-2xl font-semibold">
              {formatPct(gap.perfect.pct)}
              <span className="text-sm text-muted-foreground font-normal ml-2">
                ({gap.perfect.count} van {gap.total})
              </span>
            </span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all"
              style={{ width: `${gap.perfect.pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Advies = full_match <strong>én</strong> daadwerkelijk gevolgd door inpakker
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Coverage */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-medium">Coverage</span>
              <span className="text-lg font-semibold">{formatPct(gap.coverage.pct)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${gap.coverage.pct}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>full_match</span>
                <span className="font-medium text-foreground">{gap.coverage.full_match}</span>
              </div>
              <div className="flex justify-between">
                <span>partial_match</span>
                <span>{gap.coverage.partial_match}</span>
              </div>
              <div className="flex justify-between">
                <span>no_match</span>
                <span className="text-amber-700">{gap.coverage.no_match}</span>
              </div>
            </div>
          </div>

          {/* Compliance */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm font-medium">Compliance</span>
              <span className="text-lg font-semibold">{formatPct(gap.compliance.pct)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${gap.compliance.pct}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  followed
                </span>
                <span className="font-medium text-foreground">{gap.compliance.followed}</span>
              </div>
              <div className="flex justify-between">
                <span>modified</span>
                <span>{gap.compliance.modified}</span>
              </div>
              <div className="flex justify-between">
                <span>ignored</span>
                <span className="text-red-700">{gap.compliance.ignored}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-border mt-1">
                <span>resolved</span>
                <span>
                  {gap.compliance.resolved} / {gap.total}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Learning Funnel + Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Learning Funnel */}
        <section className="border border-border rounded-lg bg-card p-6">
          <h2 className="font-semibold mb-4">Learning pipeline</h2>
          <div className="grid grid-cols-3 gap-3">
            <FunnelStep
              label="Leert"
              count={funnel.learning}
              delta={funnel.newLearningThisWeek}
              deltaLabel="nieuw"
              color="amber"
            />
            <FunnelStep
              label="Actief"
              count={funnel.active}
              delta={funnel.promotedThisWeek}
              deltaLabel="gepromoveerd"
              color="emerald"
            />
            <FunnelStep
              label="Gedeact."
              count={funnel.invalidated}
              delta={funnel.invalidatedThisWeek}
              deltaLabel="deze week"
              color="slate"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Promotie bij 3× identiek ingepakt · Invalidation bij ≥50% override
          </p>
        </section>

        {/* Compliance trend */}
        <section className="border border-border rounded-lg bg-card p-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-semibold">Follow-rate trend</h2>
            <TrendBadge delta={trendInfo.delta} direction={trendInfo.direction} />
          </div>
          {trend.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Nog geen trend-data beschikbaar.
            </p>
          ) : (
            <TrendSparkline points={trend} />
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Laatste 12 weken · gebaseerd op resolved adviezen
          </p>
        </section>
      </div>

      {/* Navigation to sub-pages */}
      <Link
        href="/verpakkingsmodule/insights/library"
        className="group block border border-border rounded-lg bg-card p-5 hover:border-primary hover:shadow-sm transition-all"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Library className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium group-hover:text-primary">Fingerprint Library</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Alle unieke shipping-unit combinaties uit de laatste {INSIGHTS_WINDOW_DAYS} dagen,
              sorteerbaar op volume, follow-rate en kosten.
            </p>
          </div>
        </div>
      </Link>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FunnelStep({
  label,
  count,
  delta,
  deltaLabel,
  color,
}: {
  label: string
  count: number
  delta: number
  deltaLabel: string
  color: 'amber' | 'emerald' | 'slate'
}) {
  const colorMap = {
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
  } as const

  return (
    <div className={`border rounded-lg p-4 text-center ${colorMap[color]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-3xl font-semibold mt-1">{count}</div>
      <div className="text-xs mt-1 opacity-80">
        +{delta} {deltaLabel}
      </div>
    </div>
  )
}

function TrendBadge({
  delta,
  direction,
}: {
  delta: number | null
  direction: 'up' | 'down' | 'flat'
}) {
  if (delta === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  const colorClass =
    direction === 'up'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : direction === 'down'
        ? 'text-red-700 bg-red-50 border-red-200'
        : 'text-slate-700 bg-slate-50 border-slate-200'

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs ${colorClass}`}
    >
      <Icon className="w-3 h-3" />
      {delta > 0 ? '+' : ''}
      {delta.toFixed(1)}%
    </span>
  )
}

function TrendSparkline({ points }: { points: ComplianceTrendPoint[] }) {
  const width = 400
  const height = 100
  const padding = { top: 10, right: 10, bottom: 20, left: 30 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const maxRate = 100
  const minRate = 0

  const scaleX = (i: number) =>
    points.length <= 1 ? padding.left + innerW / 2 : padding.left + (i / (points.length - 1)) * innerW
  const scaleY = (rate: number) =>
    padding.top + innerH - ((rate - minRate) / (maxRate - minRate)) * innerH

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(p.followRate).toFixed(1)}`)
    .join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="none"
    >
      {/* Y axis gridlines */}
      {[0, 50, 100].map((v) => (
        <g key={v}>
          <line
            x1={padding.left}
            y1={scaleY(v)}
            x2={width - padding.right}
            y2={scaleY(v)}
            stroke="currentColor"
            strokeOpacity="0.1"
          />
          <text
            x={padding.left - 4}
            y={scaleY(v) + 3}
            textAnchor="end"
            fontSize="9"
            fill="currentColor"
            opacity="0.5"
          >
            {v}%
          </text>
        </g>
      ))}

      {/* Trend line */}
      <path d={pathD} fill="none" stroke="rgb(16 185 129)" strokeWidth="2" />

      {/* Data points */}
      {points.map((p, i) => (
        <circle
          key={p.week}
          cx={scaleX(i)}
          cy={scaleY(p.followRate)}
          r="3"
          fill="rgb(16 185 129)"
        >
          <title>
            {p.week}: {p.followRate.toFixed(0)}% gevolgd ({p.followed}/{p.total})
          </title>
        </circle>
      ))}
    </svg>
  )
}
