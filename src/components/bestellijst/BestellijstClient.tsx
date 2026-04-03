'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnSizingState,
  type ColumnOrderState,
} from '@tanstack/react-table'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { RefreshCw, ShoppingCart, Search, X, RotateCcw, GripVertical } from 'lucide-react'
import type { BestellijstRow } from '@/app/api/bestellijst/route'
import { useTablePreferences } from '@/hooks/useTablePreferences'
import DraggableColumnHeader from './DraggableColumnHeader'

const columnHelper = createColumnHelper<BestellijstRow>()

const columns = [
  columnHelper.accessor('name', {
    header: 'Product',
    size: 250,
    minSize: 120,
    meta: { pinned: true },
    cell: (info) => {
      const baseUrl = info.table.options.meta?.picqerBaseUrl
      const row = info.row.original
      return baseUrl ? (
        <a
          href={`${baseUrl}/products/${row.idproduct}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline truncate block"
        >
          {info.getValue()}
        </a>
      ) : (
        <span className="truncate block">{info.getValue()}</span>
      )
    },
  }),
  columnHelper.accessor('productcode', {
    header: 'Code',
    size: 120,
    minSize: 80,
    cell: (info) => (
      <span className="text-muted-foreground font-mono text-xs">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('productcode_supplier', {
    header: 'Lev. code',
    size: 120,
    minSize: 80,
    cell: (info) => (
      <span className="text-muted-foreground font-mono text-xs">
        {info.getValue() || '\u2014'}
      </span>
    ),
  }),
  columnHelper.accessor('supplier_name', {
    header: 'Leverancier',
    size: 140,
    minSize: 80,
    cell: (info) => (
      <span className="text-muted-foreground text-xs whitespace-nowrap">
        {info.getValue() || '\u2014'}
      </span>
    ),
  }),
  columnHelper.accessor('backorder_amount', {
    header: 'Backorder',
    size: 100,
    minSize: 70,
    meta: { align: 'right' },
    cell: (info) => (
      <span className="text-red-600 font-medium">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('freestock', {
    header: 'Vrije voorraad',
    size: 120,
    minSize: 80,
    meta: { align: 'right' },
    cell: (info) => {
      const val = info.getValue()
      return (
        <span className={val <= 0 ? 'text-red-600' : 'text-emerald-600'}>
          {val}
        </span>
      )
    },
  }),
  columnHelper.accessor('purchased_incoming', {
    header: 'Ingekocht (onderweg)',
    size: 150,
    minSize: 100,
    meta: { align: 'right' },
    cell: (info) => {
      const val = info.getValue()
      return val > 0 ? (
        <span className="text-blue-600">{val}</span>
      ) : (
        <span className="text-muted-foreground">0</span>
      )
    },
  }),
  columnHelper.accessor('demand_7d', {
    header: 'Vraag 7d',
    size: 90,
    minSize: 60,
    meta: { align: 'right' },
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('demand_14d', {
    header: 'Vraag 14d',
    size: 90,
    minSize: 60,
    meta: { align: 'right' },
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('demand_28d', {
    header: 'Vraag 28d',
    size: 90,
    minSize: 60,
    meta: { align: 'right' },
    cell: (info) => (
      <span className="text-muted-foreground">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor('nog_te_bestellen', {
    header: 'Nog te bestellen',
    size: 130,
    minSize: 90,
    meta: { align: 'right' },
    cell: (info) => {
      const val = info.getValue()
      return val > 0 ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          {val}
        </span>
      ) : (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
          0 ✓
        </span>
      )
    },
  }),
]

export default function BestellijstClient() {
  const [rows, setRows] = useState<BestellijstRow[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState<string>('')
  const [picqerBaseUrl, setPicqerBaseUrl] = useState<string>('')

  // TanStack Table state
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'nog_te_bestellen', desc: true },
  ])

  // Persistent column preferences
  const {
    columnOrder,
    setColumnOrder,
    columnSizing,
    setColumnSizing,
    resetPreferences,
  } = useTablePreferences('bestellijst')

  // Dnd state
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/bestellijst')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const { data, suppliers: supplierList, meta } = await res.json()
      setRows(data)
      setSuppliers(supplierList || [])
      setFetchedAt(meta?.fetched_at || new Date().toISOString())
      setPicqerBaseUrl(meta?.picqer_base_url || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [])

  // Pre-filter rows (search + supplier) before passing to table
  const filteredRows = useMemo(() => {
    let result = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (r) => r.name.toLowerCase().includes(q) || r.productcode.toLowerCase().includes(q)
      )
    }
    if (supplierFilter) {
      result = result.filter((r) => r.supplier_name === supplierFilter)
    }
    return result
  }, [rows, search, supplierFilter])

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: {
      sorting,
      columnOrder: columnOrder.length > 0 ? columnOrder : undefined,
      columnSizing: columnSizing as ColumnSizingState,
    },
    onSortingChange: setSorting,
    onColumnOrderChange: (updater) => {
      const newOrder = typeof updater === 'function'
        ? updater(columnOrder as ColumnOrderState)
        : updater
      setColumnOrder(newOrder)
    },
    onColumnSizingChange: (updater) => {
      const newSizing = typeof updater === 'function'
        ? updater(columnSizing as ColumnSizingState)
        : updater
      setColumnSizing(newSizing as Record<string, number>)
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode: 'onChange',
    meta: { picqerBaseUrl },
  })

  function handleDragStart(event: DragStartEvent) {
    const columnId = event.active.data.current?.columnId as string
    setActiveColumnId(columnId)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (active && over) {
      const fromId = active.data.current?.columnId as string
      const toId = over.data.current?.columnId as string
      if (fromId && toId && fromId !== toId) {
        const currentOrder = table.getState().columnOrder.length > 0
          ? table.getState().columnOrder
          : table.getAllLeafColumns().map((c) => c.id)
        const oldIndex = currentOrder.indexOf(fromId)
        const newIndex = currentOrder.indexOf(toId)
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = [...currentOrder]
          newOrder.splice(oldIndex, 1)
          newOrder.splice(newIndex, 0, fromId)
          setColumnOrder(newOrder)
        }
      }
    }
    setActiveColumnId(null)
  }

  const hasCustomPreferences = columnOrder.length > 0 || Object.keys(columnSizing).length > 0

  return (
    <main className="flex-1 p-6">
      <div className="max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
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
            {hasCustomPreferences && (
              <button
                onClick={resetPreferences}
                className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted/50 transition-colors"
                title="Kolominstellingen resetten"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset kolommen
              </button>
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

        {/* Search + Filter bar */}
        {rows.length > 0 && (
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Zoek op product of code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="">Alle leveranciers</option>
              {suppliers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {(search || supplierFilter) && (
              <button
                onClick={() => { setSearch(''); setSupplierFilter('') }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Filters wissen
              </button>
            )}
          </div>
        )}

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
              {filteredRows.length === rows.length
                ? `${rows.length} product${rows.length !== 1 ? 'en' : ''} met backorders`
                : `${filteredRows.length} van ${rows.length} producten`}
            </div>
            <div className="border border-border rounded-lg overflow-x-auto">
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <table
                  className="w-full text-sm"
                  style={{ width: table.getCenterTotalSize(), tableLayout: 'fixed' }}
                >
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="bg-muted/50 text-muted-foreground">
                        {headerGroup.headers.map((header) => (
                          <DraggableColumnHeader key={header.id} header={header} />
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-t border-border hover:bg-muted/30 transition-colors"
                      >
                        {row.getVisibleCells().map((cell) => {
                          const isPinned = cell.column.columnDef.meta?.pinned
                          return (
                            <td
                              key={cell.id}
                              className={`px-3 py-2.5 ${
                                cell.column.columnDef.meta?.align === 'right' ? 'text-right' : ''
                              } ${isPinned ? 'sticky left-0 z-10 bg-background' : ''}`}
                              style={{ width: cell.column.getSize() }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <DragOverlay>
                  {activeColumnId ? (
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-card border border-border rounded-md shadow-lg text-sm font-medium whitespace-nowrap">
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                      {columns.find((c) => c.id === activeColumnId)?.header as string}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
