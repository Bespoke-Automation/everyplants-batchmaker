'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Search,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import type {
  LearnedPatternRow,
  LearnedPatternStatus,
} from '@/lib/engine/insights'

interface SettingRow {
  key: 'invalidation_override_ratio' | 'invalidation_min_observations' | 'promotion_threshold'
  value: number
  description: string | null
  updated_at: string
}

const STATUS_META: Record<
  LearnedPatternStatus,
  { label: string; icon: typeof CheckCircle2; cls: string; dotCls: string }
> = {
  active: {
    label: 'Actief',
    icon: CheckCircle2,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotCls: 'bg-emerald-500',
  },
  learning: {
    label: 'Leert',
    icon: Clock,
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    dotCls: 'bg-amber-500',
  },
  invalidated: {
    label: 'Gedeact.',
    icon: XCircle,
    cls: 'bg-slate-50 text-slate-600 border-slate-200',
    dotCls: 'bg-slate-400',
  },
}

export default function LearnedPatternsExplorer() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [rows, setRows] = useState<LearnedPatternRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<LearnedPatternStatus | 'all'>(
    () => {
      const raw = searchParams.get('status')
      return raw === 'learning' || raw === 'active' || raw === 'invalidated' || raw === 'all'
        ? raw
        : 'all'
    },
  )
  const [minTimesSeen, setMinTimesSeen] = useState<number>(() => {
    const raw = searchParams.get('min')
    const n = raw ? Number(raw) : 0
    return Number.isNaN(n) ? 0 : n
  })
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')

  // Settings panel state
  const [settings, setSettings] = useState<SettingRow[]>([])
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const syncUrl = useCallback(() => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (minTimesSeen > 0) params.set('min', String(minTimesSeen))
    if (search.trim()) params.set('q', search.trim())
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [statusFilter, minTimesSeen, search, pathname, router])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (minTimesSeen > 0) params.set('min', String(minTimesSeen))
      if (search.trim()) params.set('q', search.trim())

      const res = await fetch(`/api/verpakking/insights/patterns?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRows(data.rows ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, minTimesSeen, search])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const res = await fetch('/api/verpakking/insights/settings')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSettings(data.rows ?? [])
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (settingsOpen && settings.length === 0) {
      fetchSettings()
    }
  }, [settingsOpen, settings.length, fetchSettings])

  const handleSettingChange = async (key: SettingRow['key'], value: number) => {
    setSavingKey(key)
    setSettingsError(null)
    try {
      const res = await fetch('/api/verpakking/insights/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      // Update local state optimistically
      setSettings((prev) =>
        prev.map((s) => (s.key === key ? { ...s, value, updated_at: new Date().toISOString() } : s)),
      )
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setSavingKey(null)
    }
  }

  const handleAction = async (
    patternId: string,
    action: 'invalidate' | 'reactivate',
    confirmMessage: string,
  ) => {
    if (!confirm(confirmMessage)) return
    try {
      const res = await fetch(`/api/verpakking/insights/patterns/${patternId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(`Actie mislukt: ${data.error ?? res.statusText}`)
        return
      }
      await fetchRows()
    } catch (err) {
      alert(`Actie mislukt: ${err instanceof Error ? err.message : 'Onbekende fout'}`)
    }
  }

  const counts = useMemo(() => {
    const c = { active: 0, learning: 0, invalidated: 0 }
    for (const r of rows) c[r.status]++
    return c
  }, [rows])

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/verpakkingsmodule/insights"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" />
            Terug naar Insights
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Geleerde Patronen</h1>
          <p className="text-sm text-muted-foreground">
            Product-combinaties die het systeem heeft leren inpakken.
          </p>
        </div>
        <button
          onClick={fetchRows}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Vernieuwen
        </button>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-3 gap-3">
        <StatusCard
          label={STATUS_META.active.label}
          count={counts.active}
          cls={STATUS_META.active.cls}
        />
        <StatusCard
          label={STATUS_META.learning.label}
          count={counts.learning}
          cls={STATUS_META.learning.cls}
        />
        <StatusCard
          label={STATUS_META.invalidated.label}
          count={counts.invalidated}
          cls={STATUS_META.invalidated.cls}
        />
      </div>

      {/* Settings panel */}
      <div className="border border-border rounded-lg bg-card">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Drempels aanpassen</span>
          </div>
          {settingsOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        {settingsOpen && (
          <div className="border-t border-border p-4 space-y-3">
            {settingsError && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{settingsError}</span>
              </div>
            )}
            {settingsLoading ? (
              <div className="text-sm text-muted-foreground">Laden...</div>
            ) : (
              settings.map((s) => (
                <SettingRowControl
                  key={s.key}
                  row={s}
                  saving={savingKey === s.key}
                  onChange={(value) => handleSettingChange(s.key, value)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Zoek productcode, naam of doos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LearnedPatternStatus | 'all')}
          className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
        >
          <option value="all">Alle statussen</option>
          <option value="active">Actief</option>
          <option value="learning">Leert</option>
          <option value="invalidated">Gedeactiveerd</option>
        </select>
        <select
          value={minTimesSeen}
          onChange={(e) => setMinTimesSeen(Number(e.target.value))}
          className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
        >
          <option value="0">Alle observaties</option>
          <option value="1">≥ 1 observatie</option>
          <option value="3">≥ 3 observaties</option>
          <option value="5">≥ 5 observaties</option>
          <option value="10">≥ 10 observaties</option>
        </select>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Patterns list */}
      {loading && rows.length === 0 ? (
        <div
          className="text-center py-12 text-muted-foreground"
          aria-live="polite"
          aria-busy="true"
        >
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
          Patronen laden...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
          Geen patronen gevonden met deze filters.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <PatternCard
              key={row.id}
              row={row}
              onInvalidate={() =>
                handleAction(
                  row.id,
                  'invalidate',
                  `Weet je zeker dat je dit patroon wilt deactiveren?\n\n${row.products.map((p) => `${p.quantity}× ${p.productName ?? p.productcode}`).join(' + ')}\n\nDe engine zal het niet meer adviseren.`,
                )
              }
              onReactivate={() =>
                handleAction(
                  row.id,
                  'reactivate',
                  `Weet je zeker dat je dit patroon opnieuw wilt activeren?\n\nHet patroon wordt weer beschikbaar voor het engine-advies.`,
                )
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusCard({
  label,
  count,
  cls,
}: {
  label: string
  count: number
  cls: string
}) {
  return (
    <div className={`border rounded-lg p-3 text-center ${cls}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-semibold mt-1">{count}</div>
    </div>
  )
}

function SettingRowControl({
  row,
  saving,
  onChange,
}: {
  row: SettingRow
  saving: boolean
  onChange: (value: number) => void
}) {
  const [localValue, setLocalValue] = useState(String(row.value))

  useEffect(() => {
    setLocalValue(String(row.value))
  }, [row.value])

  const label = (() => {
    switch (row.key) {
      case 'invalidation_override_ratio':
        return 'Invalidation override ratio'
      case 'invalidation_min_observations':
        return 'Min. observaties vóór invalidation'
      case 'promotion_threshold':
        return 'Promotie-drempel (observaties)'
      default:
        return row.key
    }
  })()

  const isRatio = row.key === 'invalidation_override_ratio'
  const step = isRatio ? 0.05 : 1
  const min = isRatio ? 0 : 1
  const max = isRatio ? 1 : 50

  const handleBlur = () => {
    const n = Number(localValue)
    if (Number.isNaN(n) || n === row.value) {
      setLocalValue(String(row.value))
      return
    }
    onChange(n)
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <label className="text-sm font-medium">{label}</label>
        {row.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{row.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <input
          type="number"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleBlur}
          step={step}
          min={min}
          max={max}
          disabled={saving}
          className="w-24 px-2 py-1 border border-border rounded text-sm text-right disabled:opacity-50"
        />
        {saving && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>
    </div>
  )
}

function PatternCard({
  row,
  onInvalidate,
  onReactivate,
}: {
  row: LearnedPatternRow
  onInvalidate: () => void
  onReactivate: () => void
}) {
  const statusMeta = STATUS_META[row.status]
  const StatusIcon = statusMeta.icon

  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        {/* Left: status + content */}
        <div className="flex-1 min-w-0">
          {/* Status row */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${statusMeta.cls}`}
            >
              <StatusIcon className="w-3 h-3" />
              {statusMeta.label}
            </span>
            {row.isDrifting && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border bg-red-50 text-red-700 border-red-200">
                <AlertTriangle className="w-3 h-3" />
                Kalft af
              </span>
            )}
            {row.status === 'learning' && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-20 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500"
                    style={{ width: `${row.promotionProgress * 100}%` }}
                  />
                </div>
                <span>
                  {row.timesSeen}/{Math.max(row.timesSeen, Math.round(row.timesSeen / (row.promotionProgress || 1)))}
                </span>
              </div>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              Laatst: {new Date(row.lastSeenAt).toLocaleDateString('nl-NL')}
            </span>
          </div>

          {/* Products */}
          <div className="text-sm font-medium">
            {row.products.map((p, i) => (
              <span key={p.productcode}>
                {i > 0 && <span className="text-muted-foreground"> + </span>}
                <span>{p.quantity}× </span>
                <span>{p.productName ?? p.productcode}</span>
                {p.productName && (
                  <span className="text-xs text-muted-foreground ml-1">({p.productcode})</span>
                )}
              </span>
            ))}
          </div>

          {/* Box pattern */}
          <div className="text-sm text-muted-foreground mt-1">
            →{' '}
            {row.boxPattern.map((b, i) => (
              <span key={`${b.idpackaging}-${i}`}>
                {i > 0 && ' + '}
                <span className="font-mono text-xs">1× {b.packaging_name}</span>
              </span>
            ))}
          </div>

          {/* Observations */}
          <div className="text-xs text-muted-foreground mt-2">
            {row.timesSeen} observaties · {row.timesOverridden} overrides
            {row.timesOverridden > 0 && (
              <span> ({(row.overrideRatio * 100).toFixed(0)}%)</span>
            )}
            {row.invalidationReason && (
              <span className="ml-2 italic">— {row.invalidationReason}</span>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {row.status !== 'invalidated' && (
            <button
              onClick={onInvalidate}
              className="text-xs px-2 py-1 text-red-700 hover:bg-red-50 rounded transition-colors"
              title="Deactiveer patroon"
            >
              Deactiveer
            </button>
          )}
          {row.status === 'invalidated' && (
            <button
              onClick={onReactivate}
              className="text-xs px-2 py-1 text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
              title="Activeer patroon opnieuw"
            >
              Heractiveer
            </button>
          )}
          <Link
            href={`/verpakkingsmodule/insights/patterns/${row.id}`}
            className="text-xs px-2 py-1 text-primary hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
          >
            Detail
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  )
}
