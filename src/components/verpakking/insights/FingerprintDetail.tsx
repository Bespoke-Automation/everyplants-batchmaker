'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  RefreshCw,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Edit,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type {
  AdviceConfidence,
  AdviceOutcome,
  FingerprintDetail as FingerprintDetailData,
} from '@/lib/engine/insights'
import { INSIGHTS_WINDOW_DAYS } from '@/lib/engine/insights'

type InsightsModel = 'legacy' | 'observation'

export default function FingerprintDetail({
  fingerprint,
  country,
}: {
  fingerprint: string
  country: string | null
}) {
  const searchParams = useSearchParams()
  const model: InsightsModel =
    searchParams.get('model') === 'observation' ? 'observation' : 'legacy'

  const [data, setData] = useState<FingerprintDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accompanyingOpen, setAccompanyingOpen] = useState(false)

  useEffect(() => {
    const fetchDetail = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (model === 'observation') params.set('model', 'observation')
        // Country is ignored by the API in observation mode but kept for legacy
        if (model === 'legacy' && country) params.set('country', country)
        const qs = params.toString() ? `?${params.toString()}` : ''

        const res = await fetch(
          `/api/verpakking/insights/fingerprints/${encodeURIComponent(fingerprint)}${qs}`,
        )
        if (res.status === 404) {
          setError('Fingerprint niet gevonden')
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
    }
    fetchDetail()
  }, [fingerprint, country, model])

  if (loading) {
    return (
      <div
        className="max-w-5xl mx-auto py-12 text-center text-muted-foreground"
        aria-live="polite"
        aria-busy="true"
      >
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Detail laden...
      </div>
    )
  }

  const libraryHref =
    model === 'observation'
      ? '/verpakkingsmodule/insights/library?model=observation'
      : '/verpakkingsmodule/insights/library'

  if (error || !data) {
    return (
      <div className="max-w-5xl mx-auto py-8">
        <Link
          href={libraryHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar library
        </Link>
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error ?? 'Onbekende fout'}</span>
        </div>
      </div>
    )
  }

  const { stats, boxCombos, recentRecords } = data
  const isV2 = model === 'observation'

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href={libraryHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" />
          Terug naar library
        </Link>
        <h1 className="text-xl font-semibold mt-2 font-mono break-all">{data.fingerprint}</h1>
        {data.country && !isV2 && (
          <p className="text-sm text-muted-foreground mt-1">Land: {data.country}</p>
        )}
        {isV2 && (
          <p className="text-[11px] text-muted-foreground mt-1">
            Model: product-observaties (land-onafhankelijk)
          </p>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Totaal"
          value={String(stats.total)}
          hint={`laatste ${INSIGHTS_WINDOW_DAYS} dagen`}
        />
        <StatCard
          label="Volgrate"
          value={stats.followRate === null ? '—' : `${stats.followRate.toFixed(0)}%`}
          hint={`${stats.resolved} resolved`}
        />
        <StatCard
          label="Varianten"
          value={String(stats.distinctBoxCombos)}
          hint="verschillende combinaties"
        />
        <StatCard
          label="Ø advies-kosten"
          value={stats.avgAdviceCost === null ? '—' : `€ ${stats.avgAdviceCost.toFixed(2)}`}
          hint="gemiddeld"
        />
      </div>

      {/* Outcome breakdown */}
      {stats.resolved > 0 && (
        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-3">Outcome verdeling</h2>
          <div className="flex items-center gap-1 h-6 rounded overflow-hidden bg-muted text-xs">
            {stats.followed > 0 && (
              <div
                className="bg-emerald-500 text-white flex items-center justify-center h-full"
                style={{ flex: stats.followed }}
              >
                {stats.followed}
              </div>
            )}
            {stats.modified > 0 && (
              <div
                className="bg-amber-500 text-white flex items-center justify-center h-full"
                style={{ flex: stats.modified }}
              >
                {stats.modified}
              </div>
            )}
            {stats.ignored > 0 && (
              <div
                className="bg-red-500 text-white flex items-center justify-center h-full"
                style={{ flex: stats.ignored }}
              >
                {stats.ignored}
              </div>
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-emerald-500 rounded-full" />
              Gevolgd: {stats.followed}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-amber-500 rounded-full" />
              Gewijzigd: {stats.modified}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              Genegeerd: {stats.ignored}
            </span>
          </div>
        </section>
      )}

      {/* Box combinations */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Gekozen doos-combinaties</h2>
        {boxCombos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen doos-data beschikbaar.</p>
        ) : (
          <div className="space-y-2">
            {boxCombos.map((b) => (
              <div
                key={b.combo}
                className="flex items-center gap-3 p-2 rounded border border-border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{b.combo}</p>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {b.count}× gebruikt · {b.share.toFixed(0)}% van totaal
                    {b.avgAdviceCost !== null && (
                      <span> · Ø € {b.avgAdviceCost.toFixed(2)}</span>
                    )}
                  </div>
                </div>
                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${b.share}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent records */}
      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-3">Laatste 20 adviezen</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="border-b border-border">
              <tr className="text-muted-foreground">
                <th className="text-left py-2 font-medium">Datum</th>
                <th className="text-left py-2 font-medium">Order</th>
                <th className="text-left py-2 font-medium">Confidence</th>
                <th className="text-left py-2 font-medium">Advies → Werkelijk</th>
                <th className="text-left py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recentRecords.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(r.calculated_at).toLocaleDateString('nl-NL')}
                  </td>
                  <td className="py-2 font-mono">{r.order_id}</td>
                  <td className="py-2">
                    <ConfidenceBadge confidence={r.confidence} />
                  </td>
                  <td className="py-2">
                    <div className="text-muted-foreground">
                      {r.adviceBoxes.join(', ') || '—'}
                    </div>
                    {r.actualBoxes.length > 0 && (
                      <div className="text-foreground">→ {r.actualBoxes.join(', ')}</div>
                    )}
                  </td>
                  <td className="py-2">
                    <OutcomeBadge outcome={r.outcome} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Accompanying products (flyers/cards in these patterns) — V2 only */}
      {isV2 && (
        <section className="border border-border rounded-lg bg-card">
          <button
            type="button"
            onClick={() => setAccompanyingOpen((s) => !s)}
            aria-expanded={accompanyingOpen}
            className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30"
          >
            <div>
              <h2 className="font-semibold">Flyers &amp; kaartjes in deze patronen</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Niet meegeteld in de fingerprint, wel meeverpakt.
              </p>
            </div>
            {accompanyingOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            )}
          </button>
          {accompanyingOpen && (
            <div className="px-4 pb-4 pt-1 text-sm text-muted-foreground border-t border-border">
              <p>
                Accompanying-data wordt later toegevoegd — hier verschijnt een lijst met
                flyers, giftcards en kaartjes die vaak bij dit patroon worden meegepakt,
                gebaseerd op de sessie-producten na de accompanying-filter.
              </p>
              <div className="mt-3 text-[11px] font-mono text-foreground/80 break-all">
                <span className="text-muted-foreground">Rauwe fingerprint:</span>{' '}
                {data.fingerprint}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Action hint */}
      <div className="border border-dashed border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
        Acties (invalideren, rule aanmaken, etc.) komen in Fase 2.
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
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
  return <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] ${cls}`}>{label}</span>
}

function OutcomeBadge({ outcome }: { outcome: AdviceOutcome | null }) {
  if (outcome === null) {
    return <span className="text-muted-foreground text-[10px]">niet resolved</span>
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
