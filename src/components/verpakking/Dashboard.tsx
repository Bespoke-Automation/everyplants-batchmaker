'use client'

import { useState, useEffect } from 'react'
import {
  BarChart3,
  RefreshCw,
  Loader2,
  AlertCircle,
  TrendingUp,
  Package,
  CheckCircle,
  XCircle,
  Scale,
  Layers,
} from 'lucide-react'

interface DashboardStats {
  period: { from: string; to: string; days: number }
  totals: { total_advices: number; with_outcome: number; total_sessions: number }
  outcomes: { followed: number; modified: number; ignored: number; no_advice: number; pending: number }
  deviations: { extra_boxes: number; fewer_boxes: number; different_packaging: number; mixed: number }
  confidence_vs_outcome: {
    full_match: { followed: number; modified: number; ignored: number; total: number }
    partial_match: { followed: number; modified: number; ignored: number; total: number }
    no_match: { total: number }
  }
  top_fingerprints: { fingerprint: string; count: number; followed: number; modified: number; ignored: number }[]
  weight_issues: { total_exceeded: number; percentage: number }
  product_coverage: { total_products: number; classified: number; unclassified: number; coverage_percentage: number }
}

interface TrendsData {
  weekly_data: {
    week_start: string
    total: number
    followed: number
    modified: number
    ignored: number
    follow_rate: number
  }[]
  problem_products: {
    productcode: string
    product_name: string
    times_unclassified: number
  }[]
  cost_impact: {
    total_advised_cost: number
    total_actual_cost: number
    potential_savings: number
    comparable_orders: number
  } | null
  carrier_breakdown: {
    shipping_provider_profile_id: number
    count: number
    followed: number
    follow_rate: number
  }[]
}

export default function Dashboard() {
  const [days, setDays] = useState(30)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [trends, setTrends] = useState<TrendsData | null>(null)
  const [trendsLoading, setTrendsLoading] = useState(true)

  const fetchStats = () => {
    setLoading(true)
    setError(null)
    fetch(`/api/verpakking/dashboard/stats?days=${days}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch stats')
        return res.json()
      })
      .then((data) => setStats(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchStats()
  }, [days])

  useEffect(() => {
    setTrendsLoading(true)
    // Convert days to weeks (roughly)
    const weeks = Math.max(4, Math.ceil(days / 7))
    fetch(`/api/verpakking/dashboard/trends?weeks=${weeks}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then((data) => setTrends(data))
      .catch(() => {}) // Non-critical
      .finally(() => setTrendsLoading(false))
  }, [days])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h3 className="text-lg font-medium mb-2">Er ging iets mis</h3>
        <p className="text-muted-foreground mb-4">{error}</p>
        <button
          onClick={fetchStats}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Opnieuw proberen
        </button>
      </div>
    )
  }

  if (!stats || stats.totals.total_advices === 0) {
    return (
      <div className="max-w-5xl mx-auto">
        <div className="text-center py-16">
          <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Nog geen data beschikbaar</h3>
          <p className="text-muted-foreground">Begin met inpakken om dashboard-data te verzamelen.</p>
        </div>
      </div>
    )
  }

  const { totals, outcomes, deviations, confidence_vs_outcome, top_fingerprints, weight_issues, product_coverage } =
    stats

  const withOutcome = totals.with_outcome
  const followedPct = withOutcome > 0 ? Math.round((outcomes.followed / withOutcome) * 100) : 0
  const modifiedPct = withOutcome > 0 ? Math.round((outcomes.modified / withOutcome) * 100) : 0
  const ignoredPct = withOutcome > 0 ? Math.round((outcomes.ignored / withOutcome) * 100) : 0
  const pendingPct = withOutcome > 0 ? Math.round((outcomes.pending / totals.total_advices) * 100) : 0

  const maxDev = Math.max(
    deviations.extra_boxes,
    deviations.fewer_boxes,
    deviations.different_packaging,
    deviations.mixed
  )

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-3 py-2 border border-border rounded-md bg-background text-sm"
          >
            <option value={7}>7 dagen</option>
            <option value={14}>14 dagen</option>
            <option value={30}>30 dagen</option>
            <option value={90}>90 dagen</option>
          </select>
          <button
            onClick={fetchStats}
            className="p-2 hover:bg-muted rounded-md transition-colors"
            title="Vernieuwen"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {/* Total advices */}
        <div className="bg-white border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Totaal adviezen</div>
          <div className="text-2xl font-bold">{totals.total_advices}</div>
        </div>

        {/* Followed */}
        <div className="bg-white border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Advies gevolgd</div>
          <div className="text-2xl font-bold">{outcomes.followed}</div>
          <div className="text-sm text-emerald-600">{withOutcome > 0 ? `${followedPct}%` : '—'}</div>
          {withOutcome > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${followedPct}%` }} />
            </div>
          )}
        </div>

        {/* Modified */}
        <div className="bg-white border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Advies aangepast</div>
          <div className="text-2xl font-bold">{outcomes.modified}</div>
          <div className="text-sm text-blue-600">{withOutcome > 0 ? `${modifiedPct}%` : '—'}</div>
          {withOutcome > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${modifiedPct}%` }} />
            </div>
          )}
        </div>

        {/* Ignored */}
        <div className="bg-white border border-border rounded-lg p-4">
          <div className="text-sm text-muted-foreground mb-1">Advies genegeerd</div>
          <div className="text-2xl font-bold">{outcomes.ignored}</div>
          <div className="text-sm text-amber-600">{withOutcome > 0 ? `${ignoredPct}%` : '—'}</div>
          {withOutcome > 0 && (
            <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 rounded-full" style={{ width: `${ignoredPct}%` }} />
            </div>
          )}
        </div>
      </div>

      {/* Outcome Distribution */}
      <div className="bg-white border border-border rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Outcome verdeling</h2>
        <div className="flex h-8 rounded-lg overflow-hidden mb-4">
          <div
            className="bg-emerald-500"
            style={{ width: `${(outcomes.followed / totals.total_advices) * 100}%` }}
            title="Gevolgd"
          />
          <div
            className="bg-blue-500"
            style={{ width: `${(outcomes.modified / totals.total_advices) * 100}%` }}
            title="Gewijzigd"
          />
          <div
            className="bg-amber-500"
            style={{ width: `${(outcomes.ignored / totals.total_advices) * 100}%` }}
            title="Genegeerd"
          />
          <div
            className="bg-gray-300"
            style={{ width: `${(outcomes.pending / totals.total_advices) * 100}%` }}
            title="Open"
          />
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded-full" />
            <span className="text-muted-foreground">Gevolgd:</span>
            <span className="font-medium">{outcomes.followed}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full" />
            <span className="text-muted-foreground">Gewijzigd:</span>
            <span className="font-medium">{outcomes.modified}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-amber-500 rounded-full" />
            <span className="text-muted-foreground">Genegeerd:</span>
            <span className="font-medium">{outcomes.ignored}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-300 rounded-full" />
            <span className="text-muted-foreground">Open:</span>
            <span className="font-medium">{outcomes.pending}</span>
          </div>
        </div>
      </div>

      {/* Deviation Analysis */}
      {outcomes.modified > 0 && (
        <div className="bg-white border border-border rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Waarom wordt advies aangepast?</h2>
          <div className="space-y-2">
            {[
              { label: 'Extra dozen', value: deviations.extra_boxes, color: 'bg-blue-500' },
              { label: 'Minder dozen', value: deviations.fewer_boxes, color: 'bg-indigo-500' },
              { label: 'Andere verpakking', value: deviations.different_packaging, color: 'bg-purple-500' },
              { label: 'Gemengd', value: deviations.mixed, color: 'bg-pink-500' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-sm w-40 text-right">{item.label}</span>
                <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                  <div
                    className={`h-full ${item.color} rounded`}
                    style={{ width: `${maxDev > 0 ? (item.value / maxDev) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium w-8">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confidence vs Outcome Matrix */}
      <div className="bg-white border border-border rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Confidence vs. Outcome</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">Confidence</th>
                <th className="text-center py-2">Gevolgd</th>
                <th className="text-center py-2">Gewijzigd</th>
                <th className="text-center py-2">Genegeerd</th>
                <th className="text-center py-2">Totaal</th>
                <th className="text-center py-2">Naleving</th>
              </tr>
            </thead>
            <tbody>
              {/* Full match */}
              <tr className="border-b">
                <td className="py-2">Full match</td>
                <td className="text-center">{confidence_vs_outcome.full_match.followed}</td>
                <td className="text-center">{confidence_vs_outcome.full_match.modified}</td>
                <td className="text-center">{confidence_vs_outcome.full_match.ignored}</td>
                <td className="text-center font-medium">{confidence_vs_outcome.full_match.total}</td>
                <td className="text-center">
                  {confidence_vs_outcome.full_match.total > 0 ? (
                    <span
                      className={
                        confidence_vs_outcome.full_match.followed / confidence_vs_outcome.full_match.total >= 0.8
                          ? 'text-emerald-600 font-medium'
                          : confidence_vs_outcome.full_match.followed / confidence_vs_outcome.full_match.total >= 0.5
                            ? 'text-amber-600 font-medium'
                            : 'text-red-600 font-medium'
                      }
                    >
                      {Math.round(
                        (confidence_vs_outcome.full_match.followed / confidence_vs_outcome.full_match.total) * 100
                      )}
                      %
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              {/* Partial match */}
              <tr className="border-b">
                <td className="py-2">Partial match</td>
                <td className="text-center">{confidence_vs_outcome.partial_match.followed}</td>
                <td className="text-center">{confidence_vs_outcome.partial_match.modified}</td>
                <td className="text-center">{confidence_vs_outcome.partial_match.ignored}</td>
                <td className="text-center font-medium">{confidence_vs_outcome.partial_match.total}</td>
                <td className="text-center">
                  {confidence_vs_outcome.partial_match.total > 0 ? (
                    <span
                      className={
                        confidence_vs_outcome.partial_match.followed / confidence_vs_outcome.partial_match.total >=
                        0.8
                          ? 'text-emerald-600 font-medium'
                          : confidence_vs_outcome.partial_match.followed / confidence_vs_outcome.partial_match.total >=
                              0.5
                            ? 'text-amber-600 font-medium'
                            : 'text-red-600 font-medium'
                      }
                    >
                      {Math.round(
                        (confidence_vs_outcome.partial_match.followed / confidence_vs_outcome.partial_match.total) *
                          100
                      )}
                      %
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              {/* No match */}
              <tr>
                <td className="py-2">No match</td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                <td className="text-center">—</td>
                <td className="text-center font-medium">{confidence_vs_outcome.no_match.total}</td>
                <td className="text-center">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Fingerprints */}
      {top_fingerprints.length > 0 && (
        <div className="bg-white border border-border rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Meest voorkomende ordertypen</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2">Pattern</th>
                  <th className="text-center py-2">Aantal</th>
                  <th className="text-center py-2">Gevolgd</th>
                  <th className="text-center py-2">Gewijzigd</th>
                  <th className="text-center py-2">Genegeerd</th>
                </tr>
              </thead>
              <tbody>
                {top_fingerprints.map((fp, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{fp.fingerprint.replace(/\|/g, ' · ')}</td>
                    <td className="text-center font-medium">{fp.count}</td>
                    <td className="text-center text-emerald-600">{fp.followed}</td>
                    <td className="text-center text-blue-600">{fp.modified}</td>
                    <td className="text-center text-amber-600">{fp.ignored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System Health */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Product Coverage */}
        <div className="bg-white border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Layers className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-semibold">Productdekking</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {product_coverage.classified} van {product_coverage.total_products} producten geclassificeerd
          </p>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full ${
                product_coverage.coverage_percentage >= 90
                  ? 'bg-emerald-500'
                  : product_coverage.coverage_percentage >= 50
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${product_coverage.coverage_percentage}%` }}
            />
          </div>
          <div
            className={`text-2xl font-bold ${
              product_coverage.coverage_percentage >= 90
                ? 'text-emerald-600'
                : product_coverage.coverage_percentage >= 50
                  ? 'text-amber-600'
                  : 'text-red-600'
            }`}
          >
            {product_coverage.coverage_percentage}%
          </div>
        </div>

        {/* Weight Issues */}
        <div className="bg-white border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-semibold">Gewichtsproblemen</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            {weight_issues.total_exceeded} adviezen met gewichtsoverschrijding
          </p>
          <div
            className={`text-2xl font-bold ${weight_issues.total_exceeded === 0 ? 'text-emerald-600' : 'text-amber-600'}`}
          >
            {weight_issues.percentage}%
          </div>
        </div>
      </div>

      {/* Loading state for trends */}
      {trendsLoading && !trends && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      )}

      {/* Trend over tijd */}
      {trends && trends.weekly_data.length > 1 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Trend over tijd
          </h3>
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="flex items-end gap-1 h-40">
              {trends.weekly_data.map((week) => {
                const maxTotal = Math.max(...trends.weekly_data.map((w) => w.total))
                const barHeight = maxTotal > 0 ? (week.total / maxTotal) * 100 : 0
                return (
                  <div key={week.week_start} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-muted-foreground">{week.follow_rate}%</span>
                    <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                      <div
                        className="w-full rounded-t bg-emerald-500 transition-all"
                        style={{ height: `${barHeight}%` }}
                        title={`${week.total} adviezen, ${week.follow_rate}% naleving`}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(week.week_start).toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Nalevingspercentage per week — hoogte = aantal adviezen
            </p>
          </div>
        </div>
      )}

      {/* Probleemproducten */}
      {trends && trends.problem_products.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            Probleemproducten
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Producten die de engine niet kan classificeren — overweeg hun attributen in Picqer aan te vullen.
          </p>
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left py-2 px-3">Productcode</th>
                  <th className="text-left py-2 px-3">Naam</th>
                  <th className="text-right py-2 px-3">Keer ongeclassificeerd</th>
                </tr>
              </thead>
              <tbody>
                {trends.problem_products.slice(0, 10).map((p) => (
                  <tr key={p.productcode} className="border-b last:border-0">
                    <td className="py-2 px-3 font-mono text-xs">{p.productcode}</td>
                    <td className="py-2 px-3 truncate max-w-[200px]">{p.product_name}</td>
                    <td className="py-2 px-3 text-right font-medium">{p.times_unclassified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Kostenimpact */}
      {trends?.cost_impact && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Package className="w-5 h-5" />
            Kostenimpact
          </h3>
          <div className="bg-white border border-border rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-sm text-muted-foreground mb-1">Advies kosten</div>
                <div className="text-xl font-bold">€{trends.cost_impact.total_advised_cost.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Werkelijke kosten</div>
                <div className="text-xl font-bold">€{trends.cost_impact.total_actual_cost.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground mb-1">Potentiële besparing</div>
                <div
                  className={`text-xl font-bold ${trends.cost_impact.potential_savings > 0 ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {trends.cost_impact.potential_savings > 0 ? '+' : ''}€
                  {trends.cost_impact.potential_savings.toFixed(2)}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3 text-center">
              Gebaseerd op {trends.cost_impact.comparable_orders} vergelijkbare orders met ingevulde
              verpakkingskosten
            </p>
          </div>
        </div>
      )}

      {/* Carrier verdeling */}
      {trends && trends.carrier_breakdown.length > 0 && (
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Layers className="w-5 h-5" />
            Carrier verdeling
          </h3>
          <div className="bg-white border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left py-2 px-3">Carrier profiel</th>
                  <th className="text-right py-2 px-3">Orders</th>
                  <th className="text-right py-2 px-3">Gevolgd</th>
                  <th className="text-right py-2 px-3">Naleving</th>
                </tr>
              </thead>
              <tbody>
                {trends.carrier_breakdown.map((c) => (
                  <tr key={c.shipping_provider_profile_id} className="border-b last:border-0">
                    <td className="py-2 px-3">Profiel #{c.shipping_provider_profile_id}</td>
                    <td className="py-2 px-3 text-right">{c.count}</td>
                    <td className="py-2 px-3 text-right">{c.followed}</td>
                    <td className="py-2 px-3 text-right">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          c.follow_rate >= 80
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.follow_rate >= 50
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {c.follow_rate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
