'use client'

import { useMemo, useState, useCallback } from 'react'
import { RefreshCw, Download, FileText, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, RotateCcw, FileDown, AlertCircle, Clock, Loader2 } from 'lucide-react'
import { EnrichedBatch } from '@/lib/supabase/shipmentLabels'
import { useTableSearch } from '@/hooks/useTableSearch'
import TableSearch from '@/components/ui/TableSearch'

interface BatchHistoryTableProps {
  batches: EnrichedBatch[]
  isLoading: boolean
  onRefresh: () => void
  page: number
  totalPages: number
  totalCount: number
  onPageChange: (page: number) => void
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-700 border-green-200',
  partial: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  processing: 'bg-blue-100 text-blue-700 border-blue-200',
  processing_shipments: 'bg-blue-100 text-blue-700 border-blue-200',
  batch_created: 'bg-blue-100 text-blue-700 border-blue-200',
  trigger_failed: 'bg-red-100 text-red-700 border-red-200',
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Voltooid',
  partial: 'Gedeeltelijk',
  failed: 'Mislukt',
  processing: 'Bezig...',
  processing_shipments: 'Bezig...',
  batch_created: 'Aangemaakt',
  trigger_failed: 'Trigger mislukt',
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDuration(startDate: string, endDate: string): string {
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const diffMs = end - start

  if (diffMs < 1000) return '<1s'
  if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`
  const minutes = Math.floor(diffMs / 60000)
  const seconds = Math.round((diffMs % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function truncateList(items: string[], maxDisplay: number = 2): { text: string; hasMore: boolean } {
  if (items.length === 0) return { text: '-', hasMore: false }
  if (items.length <= maxDisplay) return { text: items.join(', '), hasMore: false }
  return {
    text: items.slice(0, maxDisplay).join(', '),
    hasMore: true,
  }
}

export default function BatchHistoryTable({
  batches,
  isLoading,
  onRefresh,
  page,
  totalPages,
  totalCount,
  onPageChange,
}: BatchHistoryTableProps) {
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({})

  const searchableFields = useMemo(() => [
    'picqer_batch_number' as const,
    'name' as const,
    'status' as const,
    (batch: EnrichedBatch) => batch.plants.join(' '),
    (batch: EnrichedBatch) => batch.retailers.join(' '),
  ], [])

  const { searchQuery, setSearchQuery, filteredItems: searchedBatches, clearSearch, isSearching } = useTableSearch(
    batches,
    searchableFields
  )

  const toggleExpanded = useCallback((batchId: string) => {
    setExpandedBatchId(prev => prev === batchId ? null : batchId)
  }, [])

  const handleRetry = useCallback(async (batchId: string) => {
    setActionLoading(prev => ({ ...prev, [batchId]: 'retry' }))
    try {
      const response = await fetch(`/api/single-orders/batch/${batchId}/retry`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Retry failed')
      }
      onRefresh()
    } catch (error) {
      console.error('Retry failed:', error)
      alert(`Retry mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`)
    } finally {
      setActionLoading(prev => {
        const next = { ...prev }
        delete next[batchId]
        return next
      })
    }
  }, [onRefresh])

  const handleRecombinePdf = useCallback(async (batch: EnrichedBatch) => {
    setActionLoading(prev => ({ ...prev, [batch.batch_id]: 'recombine' }))
    try {
      const response = await fetch(`/api/single-orders/batch/${batch.batch_id}/recombine-pdf`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Recombine failed')
      }
      onRefresh()
    } catch (error) {
      console.error('Recombine failed:', error)
      alert(`PDF genereren mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`)
    } finally {
      setActionLoading(prev => {
        const next = { ...prev }
        delete next[batch.batch_id]
        return next
      })
    }
  }, [onRefresh])

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
        ) : searchedBatches.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">Nog geen batches aangemaakt</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ga naar Single Orders om een batch aan te maken
              </p>
            </div>
          </div>
        ) : (
          <table className="text-sm text-left w-full">
            <thead className="bg-muted text-muted-foreground uppercase text-xs font-bold sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 w-[32px]"></th>
                <th className="px-4 py-3 min-w-[100px]">Picqer #</th>
                <th className="px-4 py-3 min-w-[150px]">Naam</th>
                <th className="px-4 py-3 min-w-[180px]">Planten</th>
                <th className="px-4 py-3 min-w-[150px]">Retailers</th>
                <th className="px-4 py-3 min-w-[150px]">Datum</th>
                <th className="px-4 py-3 w-[100px] text-center">Status</th>
                <th className="px-4 py-3 w-[80px] text-center">Orders</th>
                <th className="px-4 py-3 w-[80px] text-center">Succes</th>
                <th className="px-4 py-3 w-[80px] text-center">Mislukt</th>
                <th className="px-4 py-3 w-[100px] text-center">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {searchedBatches.map((batch) => {
                const plantsDisplay = truncateList(batch.plants, 2)
                const retailersDisplay = truncateList(batch.retailers, 2)
                const isExpanded = expandedBatchId === batch.batch_id
                const hasIssues = batch.failed_shipments > 0 || batch.has_stuck_labels || batch.failed_labels.length > 0

                return (
                  <BatchRow
                    key={batch.id}
                    batch={batch}
                    plantsDisplay={plantsDisplay}
                    retailersDisplay={retailersDisplay}
                    isExpanded={isExpanded}
                    hasIssues={hasIssues}
                    actionLoading={actionLoading[batch.batch_id]}
                    onToggleExpanded={toggleExpanded}
                    onRetry={handleRetry}
                    onRecombinePdf={handleRecombinePdf}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          {searchQuery ? `${searchedBatches.length} van ${batches.length} (gezocht) | ` : ''}Pagina {page} van {totalPages || 1}
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

interface BatchRowProps {
  batch: EnrichedBatch
  plantsDisplay: { text: string; hasMore: boolean }
  retailersDisplay: { text: string; hasMore: boolean }
  isExpanded: boolean
  hasIssues: boolean
  actionLoading?: string
  onToggleExpanded: (batchId: string) => void
  onRetry: (batchId: string) => void
  onRecombinePdf: (batch: EnrichedBatch) => void
}

function BatchRow({
  batch,
  plantsDisplay,
  retailersDisplay,
  isExpanded,
  hasIssues,
  actionLoading,
  onToggleExpanded,
  onRetry,
  onRecombinePdf,
}: BatchRowProps) {
  const showRetry = batch.failed_shipments > 0 || batch.has_stuck_labels
  const showRecombine = batch.status === 'partial' || batch.status === 'completed'

  return (
    <>
      <tr
        className={`hover:bg-muted/50 transition-colors cursor-pointer ${isExpanded ? 'bg-muted/30' : ''}`}
        onClick={() => onToggleExpanded(batch.batch_id)}
      >
        <td className="px-2 py-4 text-center">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className={`w-4 h-4 ${hasIssues ? 'text-yellow-500' : 'text-muted-foreground/40'}`} />
          )}
        </td>
        <td className="px-4 py-4">
          {batch.picqer_batch_number ? (
            <span className="font-mono text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
              {batch.picqer_batch_number}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
        </td>
        <td className="px-4 py-4">
          {batch.name ? (
            <span className="text-sm font-medium">{batch.name}</span>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-1">
            <span className="text-sm" title={batch.plants.join(', ')}>
              {plantsDisplay.text}
            </span>
            {plantsDisplay.hasMore && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                +{batch.plants.length - 2}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground" title={batch.retailers.join(', ')}>
              {retailersDisplay.text}
            </span>
            {retailersDisplay.hasMore && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                +{batch.retailers.length - 2}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-4 text-muted-foreground text-xs">
          {formatDate(batch.created_at)}
        </td>
        <td className="px-4 py-4 text-center">
          <span
            className={`px-2 py-1 rounded text-xs font-semibold border ${
              STATUS_STYLES[batch.status] || STATUS_STYLES.processing
            }`}
          >
            {STATUS_LABELS[batch.status] || batch.status}
          </span>
        </td>
        <td className="px-4 py-4 text-center">
          <span className="font-medium">{batch.total_orders}</span>
        </td>
        <td className="px-4 py-4 text-center">
          <span className="text-green-600 font-medium">
            {batch.successful_shipments}
          </span>
        </td>
        <td className="px-4 py-4 text-center">
          <span className={batch.failed_shipments > 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
            {batch.failed_shipments}
          </span>
        </td>
        <td className="px-4 py-4 text-center" onClick={e => e.stopPropagation()}>
          {batch.combined_pdf_path ? (
            <a
              href={batch.combined_pdf_path}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors text-xs font-medium"
            >
              <Download className="w-3 h-3" />
              PDF
            </a>
          ) : (
            <span className="text-muted-foreground text-xs">-</span>
          )}
        </td>
      </tr>

      {/* Expanded details row */}
      {isExpanded && (
        <tr className="bg-muted/20">
          <td colSpan={11} className="px-6 py-4">
            <div className="space-y-4">
              {/* Batch metadata */}
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold">Batch ID:</span>{' '}
                  <span className="font-mono">{batch.batch_id.slice(0, 8)}...</span>
                </span>
                {batch.picqer_batch_id && (
                  <span>
                    <span className="font-semibold">Picqer Batch ID:</span> {batch.picqer_batch_id}
                  </span>
                )}
                <span>
                  <span className="font-semibold">Verwerkingstijd:</span>{' '}
                  {formatDuration(batch.created_at, batch.updated_at)}
                </span>
              </div>

              {/* Failed labels */}
              {batch.failed_labels.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-red-600 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Mislukte labels ({batch.failed_labels.length})
                  </h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {batch.failed_labels.map((label, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded px-3 py-2"
                      >
                        <span className="font-medium text-red-700 shrink-0">
                          {label.order_reference || `Label ${i + 1}`}
                        </span>
                        <span className="text-red-600 break-all">
                          {label.error_message || 'Onbekende fout'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stuck labels warning */}
              {batch.has_stuck_labels && batch.failed_labels.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 rounded px-3 py-2">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>Er zijn labels die langer dan 10 minuten in de wachtrij staan.</span>
                </div>
              )}

              {/* Action buttons */}
              {(showRetry || showRecombine) && (
                <div className="flex items-center gap-2 pt-1">
                  {showRetry && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRetry(batch.batch_id)
                      }}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-md hover:bg-amber-200 transition-colors text-xs font-medium disabled:opacity-50"
                    >
                      {actionLoading === 'retry' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5" />
                      )}
                      Opnieuw proberen
                    </button>
                  )}
                  {showRecombine && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRecombinePdf(batch)
                      }}
                      disabled={!!actionLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-800 border border-blue-200 rounded-md hover:bg-blue-200 transition-colors text-xs font-medium disabled:opacity-50"
                    >
                      {actionLoading === 'recombine' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5" />
                      )}
                      PDF opnieuw genereren
                    </button>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
