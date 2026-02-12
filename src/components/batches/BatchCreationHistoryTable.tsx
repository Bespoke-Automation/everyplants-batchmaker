'use client'

import { useMemo } from 'react'
import { RefreshCw, FileText, ChevronLeft, ChevronRight, Check, X, Webhook } from 'lucide-react'
import type { BatchCreation } from '@/types/database'
import { useTableSearch } from '@/hooks/useTableSearch'
import TableSearch from '@/components/ui/TableSearch'

interface BatchCreationHistoryTableProps {
  creations: BatchCreation[]
  isLoading: boolean
  onRefresh: () => void
  page: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
}

const STATUS_STYLES: Record<string, string> = {
  success: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
}

const STATUS_LABELS: Record<string, string> = {
  success: 'Gelukt',
  failed: 'Mislukt',
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function BatchCreationHistoryTable({
  creations,
  isLoading,
  onRefresh,
  page,
  totalPages,
  totalCount,
  onPageChange,
}: BatchCreationHistoryTableProps) {
  const searchableFields = useMemo(() => [
    (c: BatchCreation) => String(c.picqer_batch_id),
    'status' as const,
    'pps_filter' as const,
    (c: BatchCreation) => c.error_message || '',
  ], [])

  const { searchQuery, setSearchQuery, filteredItems: searchedCreations, clearSearch, isSearching } = useTableSearch(
    creations,
    searchableFields
  )

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between bg-muted/5">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> Batch Geschiedenis
          </h2>
          <span className="text-sm text-muted-foreground">
            {totalCount} batch{totalCount !== 1 ? 'es' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TableSearch
            value={searchQuery}
            onChange={setSearchQuery}
            onClear={clearSearch}
            placeholder="Zoek batches..."
            isSearching={isSearching}
          />
          <button
            onClick={onRefresh}
            disabled={isLoading}
            className="p-2 hover:bg-muted rounded-md transition-all text-muted-foreground disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Laden...</p>
            </div>
          </div>
        ) : searchedCreations.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Nog geen batches aangemaakt</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ga naar Batches om een batch aan te maken
              </p>
            </div>
          </div>
        ) : (
          <table className="text-sm text-left w-full">
            <thead className="bg-muted text-muted-foreground uppercase text-xs font-bold sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-[100px] text-center">Status</th>
                <th className="px-4 py-3 min-w-[120px]">Picqer Batch</th>
                <th className="px-4 py-3 w-[100px] text-center">Picklists</th>
                <th className="px-4 py-3 w-[80px] text-center">PPS</th>
                <th className="px-4 py-3 w-[120px] text-center">Webhook</th>
                <th className="px-4 py-3 min-w-[150px]">Datum</th>
                <th className="px-4 py-3 min-w-[200px]">Foutmelding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {searchedCreations.map((creation) => (
                <tr
                  key={creation.id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-4 text-center">
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold border ${
                        STATUS_STYLES[creation.status] || ''
                      }`}
                    >
                      {STATUS_LABELS[creation.status] || creation.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {creation.picqer_batch_id > 0 ? (
                      <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                        #{creation.picqer_batch_id}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="font-medium">{creation.picklist_count}</span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      creation.pps_filter === 'ja'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {creation.pps_filter}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {creation.webhook_triggered ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-green-600" />
                          <span className="text-green-600">Verstuurd</span>
                        </>
                      ) : (
                        <>
                          <X className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Niet verstuurd</span>
                        </>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground text-xs">
                    {formatDate(creation.created_at)}
                  </td>
                  <td className="px-4 py-4">
                    {creation.error_message ? (
                      <span className="text-red-600 text-xs truncate block max-w-[300px]" title={creation.error_message}>
                        {creation.error_message}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          {searchQuery ? `${searchedCreations.length} van ${creations.length} (gezocht) | ` : ''}Pagina {page} van {totalPages || 1}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isLoading}
            className="p-2 hover:bg-muted rounded-md transition-all text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isLoading}
            className="p-2 hover:bg-muted rounded-md transition-all text-muted-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
