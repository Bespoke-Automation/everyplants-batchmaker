'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  AlertTriangle,
  Target,
} from 'lucide-react'

interface GapMetrics {
  perfect: { pct: number }
  coverage: { pct: number }
  compliance: { pct: number }
}

interface LearningFunnel {
  promotedThisWeek: number
  invalidatedThisWeek: number
  newLearningThisWeek: number
}

interface ComplianceTrendPoint {
  week: string
  followRate: number
}

interface OverviewData {
  gap: GapMetrics
  funnel: LearningFunnel
  trend: ComplianceTrendPoint[]
}

interface BriefAction {
  title: string
  type: string
}

export default function WeeklyBrief() {
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [topActions, setTopActions] = useState<BriefAction[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBrief = useCallback(async () => {
    setLoading(true)
    try {
      const [overviewRes, actionsRes] = await Promise.all([
        fetch('/api/verpakking/insights/overview'),
        fetch('/api/verpakking/insights/actions?status=active&limit=3'),
      ])

      if (overviewRes.ok) {
        const data = await overviewRes.json()
        setOverview(data)
      }
      if (actionsRes.ok) {
        const data = await actionsRes.json()
        setTopActions(
          (data.actions ?? []).map((a: { title: string; type: string }) => ({
            title: a.title,
            type: a.type,
          })),
        )
      }
    } catch {
      // Non-critical — the brief is supplementary
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBrief()
  }, [fetchBrief])

  if (loading || !overview) return null

  const { gap, funnel, trend } = overview

  // Compute trend direction from last 2 weeks
  let trendDelta: number | null = null
  let trendDirection: 'up' | 'down' | 'flat' = 'flat'
  if (trend.length >= 2) {
    const last = trend[trend.length - 1]
    const prev = trend[trend.length - 2]
    trendDelta = last.followRate - prev.followRate
    trendDirection = trendDelta > 1 ? 'up' : trendDelta < -1 ? 'down' : 'flat'
  }

  const TrendIcon =
    trendDirection === 'up' ? TrendingUp : trendDirection === 'down' ? TrendingDown : Minus
  const trendColor =
    trendDirection === 'up'
      ? 'text-emerald-700'
      : trendDirection === 'down'
        ? 'text-red-700'
        : 'text-muted-foreground'

  return (
    <section className="border border-border rounded-lg bg-gradient-to-br from-card to-muted/30 p-5">
      <div className="flex items-center gap-2 mb-3">
        <FileText className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Brief van deze week</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* KPI summary */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Perfect orders
          </div>
          <div className="text-2xl font-semibold">{gap.perfect.pct.toFixed(1)}%</div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Coverage {gap.coverage.pct.toFixed(0)}%</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Compliance {gap.compliance.pct.toFixed(0)}%</span>
          </div>
          {trendDelta !== null && (
            <div className={`flex items-center gap-1 text-xs ${trendColor}`}>
              <TrendIcon className="w-3 h-3" />
              Follow-rate {trendDelta > 0 ? '+' : ''}
              {trendDelta.toFixed(1)}% vs vorige week
            </div>
          )}
        </div>

        {/* Learning activity */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Engine activiteit
          </div>
          <div className="space-y-1">
            {funnel.promotedThisWeek > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                <span>
                  {funnel.promotedThisWeek} {funnel.promotedThisWeek === 1 ? 'patroon' : 'patronen'}{' '}
                  gepromoveerd
                </span>
              </div>
            )}
            {funnel.invalidatedThisWeek > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                <span>
                  {funnel.invalidatedThisWeek} {funnel.invalidatedThisWeek === 1 ? 'patroon' : 'patronen'}{' '}
                  gedeactiveerd
                </span>
              </div>
            )}
            {funnel.newLearningThisWeek > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <Target className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  {funnel.newLearningThisWeek} nieuwe{' '}
                  {funnel.newLearningThisWeek === 1 ? 'patroon' : 'patronen'} in leerproces
                </span>
              </div>
            )}
            {funnel.promotedThisWeek === 0 &&
              funnel.invalidatedThisWeek === 0 &&
              funnel.newLearningThisWeek === 0 && (
                <p className="text-sm text-muted-foreground">Geen leeractiviteit deze week.</p>
              )}
          </div>
        </div>

        {/* Top actions */}
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Top acties
          </div>
          {topActions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Geen openstaande acties.</p>
          ) : (
            <ul className="space-y-1">
              {topActions.map((a, i) => (
                <li key={i} className="text-sm flex items-start gap-1.5">
                  <span className="text-muted-foreground flex-shrink-0">{i + 1}.</span>
                  <span className="line-clamp-1">{a.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
