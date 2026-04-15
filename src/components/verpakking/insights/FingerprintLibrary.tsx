'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  RefreshCw,
  ArrowLeft,
  ArrowUpDown,
  AlertCircle,
  Search,
} from 'lucide-react'
import type {
  FingerprintStatsRow,
  FingerprintSuggestedAction,
} from '@/lib/engine/insights'
import { INSIGHTS_WINDOW_DAYS } from '@/lib/engine/insights'
import type { ResolvedFingerprintEntry } from '@/lib/engine/fingerprintResolver'

type SortKey = 'total' | 'followRate' | 'avgAdviceCost' | 'distinctBoxCombos'
type SortDir = 'asc' | 'desc'
type InsightsModel = 'legacy' | 'observation'

const VALID_SORT_KEYS: SortKey[] = ['total', 'followRate', 'avgAdviceCost', 'distinctBoxCombos']

const ACTION_STYLES: Record<FingerprintSuggestedAction, { label: string; cls: string }> = {
  healthy: { label: 'Gezond', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  drifting: { label: 'Kalft af', cls: 'bg-red-50 text-red-700 border-red-200' },
  rising: { label: 'In opkomst', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  no_consensus: { label: 'Geen consensus', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  no_advice: { label: 'Geen advies', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  unresolved: { label: 'Niet resolved', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
}

function formatCost(n: number | null): string {
  if (n === null) return '—'
  return `€ ${n.toFixed(2)}`
}

function formatPct(n: number | null): string {
  if (n === null) return '—'
  return `${n.toFixed(0)}%`
}

/**
 * Parse a V2 fingerprint ("productcode:qty|productcode:qty") into entries.
 * Returns empty array on malformed input.
 */
function parseV2Fingerprint(
  fingerprint: string,
): Array<{ productcode: string; quantity: number }> {
  if (!fingerprint) return []
  return fingerprint
    .split('|')
    .map((part) => {
      const [code, qtyStr] = part.split(':')
      const quantity = Number(qtyStr)
      if (!code || Number.isNaN(quantity)) return null
      return { productcode: code.trim(), quantity }
    })
    .filter((x): x is { productcode: string; quantity: number } => x !== null)
}

/**
 * Render a V2 fingerprint as "1× Strelitzia + 2× Philodendron" using the
 * resolved names where available. Falls back to the raw productcode when the
 * name is unknown. Called only in observation-model mode.
 */
function renderV2Fingerprint(
  fingerprint: string,
  names: Map<string, string>,
): string {
  const entries = parseV2Fingerprint(fingerprint)
  if (entries.length === 0) return fingerprint
  return entries
    .map((e) => `${e.quantity}× ${names.get(e.productcode) ?? e.productcode}`)
    .join(' + ')
}

export default function FingerprintLibrary() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [rows, setRows] = useState<FingerprintStatsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state — initialized from URL, synced back on change
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const [actionFilter, setActionFilter] = useState<string | null>(
    () => searchParams.get('status') ?? null,
  )
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const raw = searchParams.get('sort')
    return raw && (VALID_SORT_KEYS as string[]).includes(raw) ? (raw as SortKey) : 'total'
  })
  const [sortDir, setSortDir] = useState<SortDir>(
    () => (searchParams.get('dir') === 'asc' ? 'asc' : 'desc'),
  )
  const [model, setModel] = useState<InsightsModel>(() =>
    searchParams.get('model') === 'observation' ? 'observation' : 'legacy',
  )

  // V2 resolved productcode → product_name lookup for fingerprint display.
  // Loaded lazily once the observation rows arrive. Keyed by productcode.
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map())

  // Sync filter state → URL (replace, not push, so back button doesn't fill with noise)
  const syncUrl = useCallback(() => {
    const params = new URLSearchParams()
    if (search.trim()) params.set('q', search.trim())
    if (actionFilter) params.set('status', actionFilter)
    if (sortKey !== 'total') params.set('sort', sortKey)
    if (sortDir !== 'desc') params.set('dir', sortDir)
    if (model !== 'legacy') params.set('model', model)
    const qs = params.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
  }, [search, actionFilter, sortKey, sortDir, model, pathname, router])

  useEffect(() => {
    syncUrl()
  }, [syncUrl])

  useEffect(() => {
    const fetchRows = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/verpakking/insights/fingerprints?limit=500&model=${model}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setRows(data.rows ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Onbekende fout')
      } finally {
        setLoading(false)
      }
    }
    fetchRows()
  }, [model])

  // V2: pre-load product names for all productcodes in the visible rows so the
  // fingerprint column can show "1× Strelitzia Nicolai" instead of raw codes.
  // Legacy model fingerprints are not productcode-based — skip.
  useEffect(() => {
    if (model !== 'observation' || rows.length === 0) {
      setProductNames(new Map())
      return
    }

    const codes = new Set<string>()
    for (const r of rows) {
      for (const p of parseV2Fingerprint(r.fingerprint)) codes.add(p.productcode)
    }
    if (codes.size === 0) return

    let cancelled = false
    const loadNames = async () => {
      try {
        const url = `/api/verpakking/insights/fingerprints/resolve?codes=${encodeURIComponent(Array.from(codes).join(','))}`
        const res = await fetch(url)
        if (!res.ok) return
        const data = (await res.json()) as { entries: ResolvedFingerprintEntry[] }
        if (cancelled || !Array.isArray(data.entries)) return

        const map = new Map<string, string>()
        for (const e of data.entries) {
          if (e.product_name) map.set(e.productcode, e.product_name)
        }
        setProductNames(map)
      } catch {
        // Silently ignore — display falls back to raw productcodes.
      }
    }
    loadNames()
    return () => {
      cancelled = true
    }
  }, [model, rows])

  const filtered = useMemo(() => {
    let result = [...rows]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (r) =>
          r.fingerprint.toLowerCase().includes(q) ||
          (r.dominantBoxCombo?.toLowerCase().includes(q) ?? false),
      )
    }
    if (actionFilter) {
      result = result.filter((r) => r.suggestedAction === actionFilter)
    }
    result.sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return sortDir === 'asc' ? (va as number) - (vb as number) : (vb as number) - (va as number)
    })
    return result
  }, [rows, search, actionFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/verpakkingsmodule/insights"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3 h-3" />
            Terug naar Insights
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Fingerprint Library</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? 'Laden...'
              : `${filtered.length} van ${rows.length} unieke ${
                  model === 'observation' ? 'product-combinaties' : 'shipping-unit patronen'
                }${model === 'legacy' ? ` · laatste ${INSIGHTS_WINDOW_DAYS} dagen` : ''}`}
          </p>
        </div>

        {/* Engine-model toggle — switches between V1 (legacy) and V2 (observations) */}
        <div
          role="group"
          aria-label="Engine model"
          className="inline-flex items-center rounded-lg border border-border overflow-hidden text-xs"
        >
          <button
            type="button"
            onClick={() => setModel('legacy')}
            aria-pressed={model === 'legacy'}
            className={`px-3 py-1.5 ${
              model === 'legacy' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted/50'
            }`}
          >
            Oud model (shipping units)
          </button>
          <button
            type="button"
            onClick={() => setModel('observation')}
            aria-pressed={model === 'observation'}
            className={`px-3 py-1.5 border-l border-border ${
              model === 'observation'
                ? 'bg-primary text-primary-foreground'
                : 'bg-background hover:bg-muted/50'
            }`}
          >
            Nieuw model (productcodes)
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Zoek fingerprint of doos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={actionFilter ?? ''}
          onChange={(e) => setActionFilter(e.target.value || null)}
          className="px-3 py-2 border border-border rounded-lg text-sm bg-background"
        >
          <option value="">Alle statussen</option>
          {Object.entries(ACTION_STYLES).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Fingerprint</th>
                <SortableTh
                  label="Volume"
                  columnKey="total"
                  align="right"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <th className="text-left px-3 py-2 font-medium">Dominante doos-combinatie</th>
                <SortableTh
                  label="Varianten"
                  columnKey="distinctBoxCombos"
                  align="right"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <SortableTh
                  label="Volgrate"
                  columnKey="followRate"
                  align="right"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <SortableTh
                  label="Ø kosten"
                  columnKey="avgAdviceCost"
                  align="right"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                />
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    <div aria-live="polite" aria-busy="true">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
                      <span className="sr-only">Patronen laden...</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    Geen fingerprints gevonden met deze filters.
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const detailQs =
                    model === 'observation'
                      ? '?model=observation'
                      : row.country
                        ? `?country=${row.country}`
                        : ''
                  const detailHref = `/verpakkingsmodule/insights/library/${encodeURIComponent(row.fingerprint)}${detailQs}`
                  const isV2 = model === 'observation'
                  return (
                  <tr key={`${model}::${row.country ?? ''}::${row.fingerprint}`} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link
                        href={detailHref}
                        className={`text-primary hover:underline ${isV2 ? 'text-sm' : 'font-mono text-xs'}`}
                      >
                        {isV2 ? renderV2Fingerprint(row.fingerprint, productNames) : row.fingerprint}
                      </Link>
                      {isV2 && (
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5 break-all">
                          {row.fingerprint}
                        </div>
                      )}
                      {!isV2 && row.country && (
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          [{row.country}]
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{row.total}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.dominantBoxCombo ?? '—'}
                      {row.dominantBoxComboShare !== null && (
                        <span className="text-xs ml-1">
                          ({formatPct(row.dominantBoxComboShare)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{row.distinctBoxCombos}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className={
                          row.followRate === null
                            ? 'text-muted-foreground'
                            : row.followRate >= 85
                              ? 'text-emerald-700 font-medium'
                              : row.followRate >= 60
                                ? 'text-amber-700'
                                : 'text-red-700 font-medium'
                        }
                      >
                        {formatPct(row.followRate)}
                      </span>
                      {row.resolved > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {row.resolved} resolved
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatCost(row.avgAdviceCost)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block text-[10px] px-2 py-0.5 rounded border ${ACTION_STYLES[row.suggestedAction].cls}`}
                      >
                        {ACTION_STYLES[row.suggestedAction].label}
                      </span>
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SortableTh({
  label,
  columnKey,
  align,
  sortKey,
  sortDir,
  onToggle,
}: {
  label: string
  columnKey: SortKey
  align: 'left' | 'right'
  sortKey: SortKey
  sortDir: SortDir
  onToggle: (key: SortKey) => void
}) {
  const isActive = sortKey === columnKey
  const ariaSort: 'ascending' | 'descending' | 'none' = isActive
    ? sortDir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none'
  const alignClass = align === 'right' ? 'text-right' : 'text-left'

  return (
    <th className={`${alignClass} px-3 py-2 font-medium`} aria-sort={ariaSort}>
      <button
        onClick={() => onToggle(columnKey)}
        className="inline-flex items-center gap-1 hover:text-primary"
        aria-label={`Sorteer op ${label}${
          isActive ? `, nu ${sortDir === 'asc' ? 'oplopend' : 'aflopend'}` : ''
        }`}
      >
        {label}
        <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  )
}
