'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import {
  Layers,
  RefreshCw,
  ArrowRightLeft,
  Loader2,
  AlertCircle,
  ChevronRight,
  Search,
  MessageSquare,
} from 'lucide-react'
import { useBatchQueue } from '@/hooks/useBatchQueue'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import type { Worker, QueueBatch } from '@/types/verpakking'

// Relative time in Dutch (full words)
function timeAgo(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMins = Math.round(diffMs / 60000)

  if (diffMins < 1) return 'nu'
  if (diffMins === 1) return '1 minuut geleden'
  if (diffMins < 60) return `${diffMins} minuten geleden`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours === 1) return '1 uur geleden'
  if (diffHours < 24) return `${diffHours} uur geleden`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '1 dag geleden'
  return `${diffDays} dagen geleden`
}

interface BatchQueueProps {
  worker: Worker
  onClearWorker: () => void
  onBatchClaimed: (batchSessionId: string) => void
}

export default function BatchQueue({
  worker,
  onClearWorker,
  onBatchClaimed,
}: BatchQueueProps) {
  const {
    batches,
    totalBatches,
    isLoading,
    error,
    isClaiming,
    claimBatch,
    refetch,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    assignedToFilter,
    setAssignedToFilter,
    searchQuery,
    setSearchQuery,
  } = useBatchQueue(worker.iduser)

  const { users: picqerUsers } = usePicqerUsers()

  // Error feedback state
  const [openError, setOpenError] = useState<string | null>(null)
  const openErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss error after 5 seconds
  useEffect(() => {
    if (openError) {
      openErrorTimerRef.current = setTimeout(() => {
        setOpenError(null)
      }, 5000)
    }
    return () => {
      if (openErrorTimerRef.current) {
        clearTimeout(openErrorTimerRef.current)
        openErrorTimerRef.current = null
      }
    }
  }, [openError])

  const handleOpen = useCallback(
    async (batch: QueueBatch) => {
      if (batch.batchSessionId) {
        onBatchClaimed(batch.batchSessionId)
        return
      }

      setOpenError(null)

      const result = await claimBatch(
        batch.idpicklistBatch,
        batch.batchDisplayId,
        batch.totalPicklists,
        worker.fullName
      )

      if (result.success && result.batchSessionId) {
        onBatchClaimed(result.batchSessionId)
      } else if (!result.success) {
        setOpenError(result.error || 'Onbekende fout bij het openen')
      }
    },
    [claimBatch, worker.fullName, onBatchClaimed]
  )

  return (
    <div className="flex-1 flex flex-col">
      {/* Worker header bar */}
      <div className="bg-card border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            {(worker.firstname?.[0] ?? '').toUpperCase()}
            {(worker.lastname?.[0] ?? '').toUpperCase()}
          </div>
          <span className="font-semibold text-base">{worker.fullName}</span>
        </div>
        <button
          onClick={onClearWorker}
          className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[44px]"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          Wissel
        </button>
      </div>

      {/* Queue header */}
      <div className="bg-muted/30 border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-base">
            Batches
            {!isLoading && (
              <span className="text-muted-foreground font-normal ml-1.5">
                ({batches.length}{batches.length !== totalBatches ? `/${totalBatches}` : ''})
              </span>
            )}
          </h2>
        </div>
        <button
          onClick={refetch}
          disabled={isLoading}
          className="p-2 border border-border rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card border-b border-border px-5 py-2.5 space-y-2">
        {/* Row 1: Search + Status */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Zoek batch of picker..."
              className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
            {([
              { value: 'open', label: 'Open' },
              { value: 'completed', label: 'Afgerond' },
              { value: 'all', label: 'Alle' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatusFilter(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  statusFilter === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Type + Picker */}
        <div className="flex items-center gap-3">
          {/* Type filter */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
            {([
              { value: 'all', label: 'Alle types' },
              { value: 'normal', label: 'Normaal' },
              { value: 'singles', label: 'Singles' },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTypeFilter(opt.value)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  typeFilter === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Picker filter */}
          <select
            value={assignedToFilter ?? ''}
            onChange={(e) => setAssignedToFilter(e.target.value ? Number(e.target.value) : null)}
            className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
          >
            <option value="">Alle pickers</option>
            {picqerUsers.map((u) => (
              <option key={u.iduser} value={u.iduser}>
                {u.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error banner */}
      {openError && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 font-medium">{openError}</span>
          <button
            onClick={() => setOpenError(null)}
            className="shrink-0 p-1 rounded hover:bg-destructive/20 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Sluiten"
          >
            &times;
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Error state */}
        {error && (
          <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error.message}</p>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              Opnieuw
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && batches.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-muted-foreground text-sm">Laden...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && batches.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-3 text-center">
            <Layers className="w-8 h-8 text-muted-foreground" />
            <p className="text-muted-foreground text-base">Geen openstaande batches</p>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              Vernieuw
            </button>
          </div>
        )}

        {/* Batch rows */}
        {!error && batches.length > 0 && (
          <div className="divide-y divide-border">
            {batches.map((batch) => {
              const hasMySession = !!batch.batchSessionId

              return (
                <button
                  key={batch.idpicklistBatch}
                  onClick={() => handleOpen(batch)}
                  disabled={isClaiming}
                  className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors min-h-[64px] disabled:opacity-50 ${
                    hasMySession
                      ? 'bg-primary/5 hover:bg-primary/10'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  {/* Batch ID + type */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base">Batch #{batch.batchDisplayId}</span>
                      {batch.totalComments > 0 && (
                        <span
                          className="relative group inline-flex items-center text-muted-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            {batch.totalComments} {batch.totalComments === 1 ? 'opmerking' : 'opmerkingen'}
                          </span>
                        </span>
                      )}
                      {batch.type === 'singles' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-purple-100 text-purple-700">
                          Singles
                        </span>
                      )}
                      {hasMySession && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-primary/10 text-primary">
                          Actief
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <span>{batch.totalPicklists} picklijsten</span>
                      <span className="text-border">·</span>
                      <span>{batch.totalProducts} producten</span>
                      {batch.picqerAssignedTo && (
                        <>
                          <span className="text-border">·</span>
                          <span className="truncate max-w-[180px]">Gepickt door {batch.picqerAssignedTo}</span>
                        </>
                      )}
                      <span className="text-border">·</span>
                      <span>{timeAgo(batch.createdAt)}</span>
                    </div>
                  </div>

                  {/* Arrow */}
                  {isClaiming ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="w-3 h-3" />
        Auto-refresh 5s
      </div>
    </div>
  )
}
