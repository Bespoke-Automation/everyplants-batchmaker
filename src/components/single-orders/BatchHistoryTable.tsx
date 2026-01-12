'use client'

import { RefreshCw, Download, FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { SingleOrderBatch } from '@/lib/supabase/shipmentLabels'

interface BatchHistoryTableProps {
  batches: SingleOrderBatch[]
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
}

const STATUS_LABELS: Record<string, string> = {
  completed: 'Voltooid',
  partial: 'Gedeeltelijk',
  failed: 'Mislukt',
  processing: 'Bezig...',
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
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
        ) : batches.length === 0 ? (
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
                <th className="px-4 py-3 min-w-[150px]">Batch ID</th>
                <th className="px-4 py-3 min-w-[180px]">Datum</th>
                <th className="px-4 py-3 w-[100px] text-center">Status</th>
                <th className="px-4 py-3 w-[100px] text-center">Orders</th>
                <th className="px-4 py-3 w-[100px] text-center">Succes</th>
                <th className="px-4 py-3 w-[100px] text-center">Mislukt</th>
                <th className="px-4 py-3 w-[120px] text-center">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {batches.map((batch) => (
                <tr
                  key={batch.id}
                  className="hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-4">
                    <span className="font-mono text-xs bg-muted px-2 py-1 rounded">
                      {batch.batch_id}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
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
                  <td className="px-4 py-4 text-center">
                    {batch.combined_pdf_path ? (
                      <a
                        href={batch.combined_pdf_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors text-xs font-medium"
                      >
                        <Download className="w-3 h-3" />
                        Download
                      </a>
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
          Pagina {page} van {totalPages || 1}
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
