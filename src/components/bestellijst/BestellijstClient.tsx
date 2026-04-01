'use client'

import { useState, useCallback } from 'react'
import { RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ShoppingCart } from 'lucide-react'
import type { BestellijstRow } from '@/app/api/bestellijst/route'

type SortKey = keyof BestellijstRow
type SortDir = 'asc' | 'desc'

export default function BestellijstClient() {
  const [rows, setRows] = useState<BestellijstRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('nog_te_bestellen')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bestellijst')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const { data, meta } = await res.json()
      setRows(data)
      setFetchedAt(meta?.fetched_at || new Date().toISOString())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sortedRows = [...rows].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    const aNum = Number(aVal)
    const bNum = Number(bVal)
    return sortDir === 'asc' ? aNum - bNum : bNum - aNum
  })

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground/50" />
    return sortDir === 'asc'
      ? <ArrowUp className="w-3.5 h-3.5 text-primary" />
      : <ArrowDown className="w-3.5 h-3.5 text-primary" />
  }

  const columns: { key: SortKey; label: string; align?: 'right' }[] = [
    { key: 'name', label: 'Product' },
    { key: 'productcode', label: 'Code' },
    { key: 'backorder_amount', label: 'Backorder', align: 'right' },
    { key: 'freestock', label: 'Vrije voorraad', align: 'right' },
    { key: 'purchased_incoming', label: 'Ingekocht (onderweg)', align: 'right' },
    { key: 'demand_7d', label: 'Vraag 7d', align: 'right' },
    { key: 'demand_14d', label: 'Vraag 14d', align: 'right' },
    { key: 'demand_28d', label: 'Vraag 28d', align: 'right' },
    { key: 'nog_te_bestellen', label: 'Nog te bestellen', align: 'right' },
  ]

  return (
    <main className="flex-1 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">Bestellijst</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Producten met backorders — overzicht voor inkoop
            </p>
          </div>
          <div className="flex items-center gap-3">
            {fetchedAt && (
              <span className="text-xs text-muted-foreground">
                Opgehaald: {new Date(fetchedAt).toLocaleTimeString('nl-NL')}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Laden...' : rows.length === 0 ? 'Ophalen' : 'Vernieuwen'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-destructive/10 text-destructive rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Empty state */}
        {!loading && rows.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <ShoppingCart className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">
              {fetchedAt
                ? 'Geen backorders gevonden — alle producten zijn op voorraad!'
                : 'Klik op "Ophalen" om de bestellijst te laden'}
            </p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && rows.length === 0 && (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="p-8 text-center text-sm text-muted-foreground">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3" />
              <p>Bestellijst ophalen uit Picqer...</p>
              <p className="text-xs mt-1">Dit kan 30-60 seconden duren</p>
            </div>
          </div>
        )}

        {/* Table */}
        {rows.length > 0 && (
          <>
            <div className="text-xs text-muted-foreground mb-2">
              {rows.length} product{rows.length !== 1 ? 'en' : ''} met backorders
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`px-3 py-2.5 font-medium cursor-pointer hover:bg-muted/80 transition-colors select-none whitespace-nowrap ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          <SortIcon column={col.key} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr
                      key={row.idproduct}
                      className="border-t border-border hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium max-w-[250px] truncate" title={row.name}>
                        {row.name}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground font-mono text-xs">
                        {row.productcode}
                      </td>
                      <td className="px-3 py-2.5 text-right text-red-600 font-medium">
                        {row.backorder_amount}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={row.freestock <= 0 ? 'text-red-600' : 'text-emerald-600'}>
                          {row.freestock}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {row.purchased_incoming > 0 ? (
                          <span className="text-blue-600">{row.purchased_incoming}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{row.demand_7d}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{row.demand_14d}</td>
                      <td className="px-3 py-2.5 text-right text-muted-foreground">{row.demand_28d}</td>
                      <td className="px-3 py-2.5 text-right">
                        {row.nog_te_bestellen > 0 ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                            {row.nog_te_bestellen}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                            0 ✓
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
