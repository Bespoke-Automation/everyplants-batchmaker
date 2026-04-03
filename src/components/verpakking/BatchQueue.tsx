'use client'

import { useCallback, useState, useRef } from 'react'
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
import { useTranslation } from '@/i18n/LanguageContext'
import type { Worker, QueueBatch } from '@/types/verpakking'
import BatchCommentsPopup from './BatchCommentsPopup'

// Relative time helper — returns translated string via dictionary
function timeAgo(
  dateString: string,
  t: {
    now: string
    minuteAgo: string
    minutesAgo: string
    hourAgo: string
    hoursAgo: string
    dayAgo: string
    daysAgo: string
  }
): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMins = Math.round(diffMs / 60000)

  if (diffMins < 1) return t.now
  if (diffMins === 1) return t.minuteAgo
  if (diffMins < 60) return `${diffMins} ${t.minutesAgo}`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours === 1) return t.hourAgo
  if (diffHours < 24) return `${diffHours} ${t.hoursAgo}`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return t.dayAgo
  return `${diffDays} ${t.daysAgo}`
}

interface BatchQueueProps {
  worker: Worker
  onClearWorker: () => void
  onBatchPreview: (batchId: number) => void
  onBatchClaimed: (batchSessionId: string, batchId?: number) => void
}

export default function BatchQueue({
  worker,
  onClearWorker,
  onBatchPreview,
  onBatchClaimed,
}: BatchQueueProps) {
  const { t } = useTranslation()
  const {
    batches,
    totalBatches,
    isLoading,
    error,
    refetch,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    assignedToFilter,
    setAssignedToFilter,
    searchQuery,
    setSearchQuery,
    hasMoreCompleted,
    loadMoreCompleted,
  } = useBatchQueue(worker.iduser)

  const { users: picqerUsers } = usePicqerUsers()

  // Comments popup state
  const [commentsPopup, setCommentsPopup] = useState<{ batchId: number; displayId: string } | null>(null)
  const commentAnchorRef = useRef<HTMLSpanElement>(null)
  const [activeCommentAnchor, setActiveCommentAnchor] = useState<HTMLSpanElement | null>(null)

  const handleOpen = useCallback(
    (batch: QueueBatch) => {
      // Already claimed by me → go directly to batch overview
      if (batch.batchSessionId) {
        onBatchClaimed(batch.batchSessionId, batch.idpicklistBatch)
        return
      }

      // Open in preview mode (no claim, no Picqer assignment)
      onBatchPreview(batch.idpicklistBatch)
    },
    [onBatchClaimed, onBatchPreview]
  )

  const timeAgoKeys = {
    now: t.queue.timeNow,
    minuteAgo: t.queue.timeMinuteAgo,
    minutesAgo: t.queue.timeMinutesAgo,
    hourAgo: t.queue.timeHourAgo,
    hoursAgo: t.queue.timeHoursAgo,
    dayAgo: t.queue.timeDayAgo,
    daysAgo: t.queue.timeDaysAgo,
  }

  return (<>
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
          {t.queue.switchWorker}
        </button>
      </div>

      {/* Queue header */}
      <div className="bg-muted/30 border-b border-border px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-muted-foreground" />
          <h2 className="font-semibold text-base">
            {t.queue.batches}
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
              placeholder={t.queue.searchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center rounded-lg border border-border overflow-hidden shrink-0">
            {([
              { value: 'open', label: t.status.open },
              { value: 'completed', label: t.queue.filterCompleted },
              { value: 'all', label: t.queue.filterAll },
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
              { value: 'all', label: t.queue.filterAllTypes },
              { value: 'normal', label: t.queue.filterNormal },
              { value: 'singles', label: t.queue.filterSingles },
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
            <option value="">{t.queue.allPickers}</option>
            {picqerUsers.map((u) => (
              <option key={u.iduser} value={u.iduser}>
                {u.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

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
              {t.common.retry}
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && batches.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-muted-foreground text-sm">{t.common.loading}</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && batches.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-3 text-center">
            <Layers className="w-8 h-8 text-muted-foreground" />
            <p className="text-muted-foreground text-base">{t.queue.noBatches}</p>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4" />
              {t.queue.refresh}
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
                  className={`w-full flex items-center gap-4 px-5 py-4 text-left transition-colors min-h-[64px] ${
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
                          className="relative inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary cursor-pointer transition-colors"
                          onClick={(e) => {
                            e.stopPropagation()
                            const target = e.currentTarget as HTMLSpanElement
                            setActiveCommentAnchor(target)
                            setCommentsPopup({
                              batchId: batch.idpicklistBatch,
                              displayId: batch.batchDisplayId,
                            })
                          }}
                        >
                          <MessageSquare className="w-4 h-4" />
                          <span className="text-xs font-medium">{batch.totalComments}</span>
                        </span>
                      )}
                      {batch.type === 'singles' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-purple-100 text-purple-700">
                          Singles
                        </span>
                      )}
                      {batch.status === 'open' && !hasMySession && !batch.isClaimed && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-gray-100 text-gray-600">
                          {t.status.open}
                        </span>
                      )}
                      {batch.status === 'completed' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-emerald-100 text-emerald-700">
                          {t.queue.filterCompleted}
                        </span>
                      )}
                      {batch.isClaimed && batch.claimedByName && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-blue-100 text-blue-700">
                          {t.queue.active} · {batch.claimedByName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <span>{batch.totalPicklists} {t.queue.picklists}</span>
                      <span className="text-border">·</span>
                      <span>{batch.totalProducts} {t.common.products}</span>
                      {batch.picqerAssignedTo && (
                        <>
                          <span className="text-border">·</span>
                          <span className="truncate max-w-[180px]">{t.queue.pickedBy} {batch.picqerAssignedTo}</span>
                        </>
                      )}
                      <span className="text-border">·</span>
                      <span>{timeAgo(batch.createdAt, timeAgoKeys)}</span>
                    </div>
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </button>
              )
            })}

            {/* Load more button for completed batches */}
            {hasMoreCompleted && statusFilter === 'completed' && (
              <button
                onClick={loadMoreCompleted}
                className="w-full py-3 text-sm text-primary hover:bg-muted/50 transition-colors font-medium"
              >
                {t.queue.loadMore}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-muted/30 px-4 py-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="w-3 h-3" />
        {t.queue.autoRefresh}
      </div>
    </div>

    {/* Comments popup */}
    {commentsPopup && activeCommentAnchor && (
      <BatchCommentsPopup
        batchId={commentsPopup.batchId}
        batchDisplayId={commentsPopup.displayId}
        anchorRef={{ current: activeCommentAnchor }}
        onClose={() => {
          setCommentsPopup(null)
          setActiveCommentAnchor(null)
        }}
      />
    )}
    </>
  )
}
