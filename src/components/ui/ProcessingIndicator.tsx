'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronUp, Check, X, ExternalLink, RotateCw } from 'lucide-react'

export interface ActiveBatchProgress {
  batchId: string
  status: string
  total: number
  queued: number
  processing: number
  completed: number
  failed: number
  combinedPdfUrl: string | null
  createdAt: string
}

interface CompletedBatch extends ActiveBatchProgress {
  completedAt: number // timestamp when it was marked completed
}

interface ProcessingIndicatorProps {
  /** Batch that was just created - show immediately without waiting for DB */
  newlyCreatedBatch?: {
    batchId: string
    totalOrders: number
  } | null
}

export default function ProcessingIndicator({ newlyCreatedBatch }: ProcessingIndicatorProps) {
  const [activeBatches, setActiveBatches] = useState<ActiveBatchProgress[]>([])
  const [completedBatches, setCompletedBatches] = useState<CompletedBatch[]>([])
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isPolling, setIsPolling] = useState(false)
  const [retryingBatches, setRetryingBatches] = useState<Set<string>>(new Set())

  const fetchActiveBatches = useCallback(async () => {
    try {
      // Include the newly created batch ID and a timestamp to prevent caching
      const timestamp = Date.now()
      const url = newlyCreatedBatch
        ? `/api/single-orders/batch/active?includeBatchId=${encodeURIComponent(newlyCreatedBatch.batchId)}&_t=${timestamp}`
        : `/api/single-orders/batch/active?_t=${timestamp}`

      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) {
        console.error('Failed to fetch active batches:', response.status)
        return
      }

      const data = await response.json()
      const batches: ActiveBatchProgress[] = data.batches || []

      // Debug: log the received batch progress
      if (batches.length > 0) {
        console.log('[ProcessingIndicator] Received batches:', batches.map(b => ({
          id: b.batchId.slice(-8),
          completed: b.completed,
          failed: b.failed,
          processing: b.processing,
          status: b.status,
        })))
      }

      // Check for newly completed batches (were active, now not in active list)
      setActiveBatches(prevActive => {
        const newlyCompleted: CompletedBatch[] = []

        for (const prev of prevActive) {
          const stillActive = batches.find(b => b.batchId === prev.batchId)
          if (!stillActive) {
            // This batch is no longer active - it completed
            newlyCompleted.push({
              ...prev,
              status: 'completed',
              completed: prev.total - prev.failed,
              queued: 0,
              processing: 0,
              completedAt: Date.now(),
            })
          }
        }

        if (newlyCompleted.length > 0) {
          setCompletedBatches(prevCompleted => [...prevCompleted, ...newlyCompleted])
        }

        return batches
      })

    } catch (error) {
      console.error('Error fetching active batches:', error)
    }
  }, [newlyCreatedBatch])

  const retryBatch = useCallback(async (batchId: string) => {
    if (retryingBatches.has(batchId)) return

    setRetryingBatches(prev => new Set(prev).add(batchId))
    try {
      await fetch(`/api/single-orders/batch/${batchId}/process`, { method: 'POST' })
      // Fetch updated status after a short delay
      setTimeout(fetchActiveBatches, 1000)
    } catch (error) {
      console.error('Failed to retry batch:', error)
    } finally {
      setRetryingBatches(prev => {
        const next = new Set(prev)
        next.delete(batchId)
        return next
      })
    }
  }, [retryingBatches, fetchActiveBatches])

  // Poll for active batches every 2 seconds
  useEffect(() => {
    // Initial fetch
    fetchActiveBatches()
    setIsPolling(true)

    const interval = setInterval(fetchActiveBatches, 2000)

    return () => {
      clearInterval(interval)
      setIsPolling(false)
    }
  }, [fetchActiveBatches])

  // Auto-remove completed batches after 3 seconds
  useEffect(() => {
    if (completedBatches.length === 0) return

    const timeout = setTimeout(() => {
      const now = Date.now()
      setCompletedBatches(prev =>
        prev.filter(b => now - b.completedAt < 3000)
      )
    }, 1000)

    return () => clearTimeout(timeout)
  }, [completedBatches])

  // Create a placeholder batch for the newly created one (only until first API response)
  // This ensures the modal appears immediately, real data will replace it on first poll
  const newBatchPlaceholder: ActiveBatchProgress | null = newlyCreatedBatch &&
    !activeBatches.some(b => b.batchId === newlyCreatedBatch.batchId) &&
    !completedBatches.some(b => b.batchId === newlyCreatedBatch.batchId)
    ? {
        batchId: newlyCreatedBatch.batchId,
        status: 'processing_shipments',
        total: newlyCreatedBatch.totalOrders,
        queued: newlyCreatedBatch.totalOrders, // Start with all queued
        processing: 0,
        completed: 0,
        failed: 0,
        combinedPdfUrl: null,
        createdAt: new Date().toISOString(),
      }
    : null

  // Combine active and recently completed batches for display using Map for proper deduplication
  // Priority: activeBatches > completedBatches > placeholder (higher priority overwrites lower)
  const batchMap = new Map<string, ActiveBatchProgress>()

  // Add placeholder first (lowest priority - will be overwritten by real data)
  if (newBatchPlaceholder) {
    batchMap.set(newBatchPlaceholder.batchId, newBatchPlaceholder)
  }

  // Add completed batches (medium priority)
  for (const batch of completedBatches) {
    batchMap.set(batch.batchId, batch)
  }

  // Add active batches last (highest priority - overwrites placeholder and completed)
  for (const batch of activeBatches) {
    batchMap.set(batch.batchId, batch)
  }

  const allBatches = Array.from(batchMap.values())

  // Don't render if no batches to show
  if (allBatches.length === 0) {
    return null
  }

  const truncateBatchId = (batchId: string) => {
    // Format: SO-XXXXX-YYYYY -> show last part
    const parts = batchId.split('-')
    if (parts.length >= 3) {
      return `${parts[0]}-...${parts[parts.length - 1].slice(-4)}`
    }
    return batchId.slice(-8)
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between p-3 bg-muted/50 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          {(() => {
            const processingCount = activeBatches.filter(b =>
              b.status !== 'completed' && b.status !== 'partial' && b.status !== 'failed'
            ).length + (newBatchPlaceholder ? 1 : 0)
            return (
              <>
                {isPolling && processingCount > 0 && (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                )}
                <span className="font-medium text-sm">
                  {processingCount > 0
                    ? `${processingCount} batch${processingCount > 1 ? 'es' : ''} verwerken...`
                    : 'Verwerking voltooid'}
                </span>
              </>
            )
          })()}
        </div>
        {isCollapsed ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      {!isCollapsed && (
        <div className="max-h-64 overflow-y-auto">
          {allBatches.map((batch) => {
            const isCompleted = batch.status === 'completed' || batch.status === 'partial'
            const isFailed = batch.status === 'failed'
            const progress = batch.completed + batch.failed
            const progressPercent = Math.round((progress / batch.total) * 100)
            const isStuck = batch.status === 'trigger_failed' ||
              (batch.completed === 0 && batch.processing === 0 &&
               Date.now() - new Date(batch.createdAt).getTime() > 60000)
            const isRetrying = retryingBatches.has(batch.batchId)

            return (
              <div
                key={batch.batchId}
                className={`p-3 border-t border-border ${
                  isCompleted ? 'bg-green-50/50' : isFailed ? 'bg-red-50/50' : ''
                }`}
              >
                {/* Batch ID and status */}
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {truncateBatchId(batch.batchId)}
                  </span>
                  <div className="flex items-center gap-1">
                    {isCompleted && (
                      <Check className="w-4 h-4 text-green-600" />
                    )}
                    {isFailed && (
                      <X className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-xs font-medium">
                      {progress} / {batch.total}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isCompleted
                        ? 'bg-green-500'
                        : isFailed
                        ? 'bg-red-500'
                        : 'bg-primary'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Status details */}
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    {batch.completed > 0 && (
                      <span className="text-green-600">{batch.completed} gereed</span>
                    )}
                    {batch.failed > 0 && (
                      <span className="text-red-600">{batch.failed} mislukt</span>
                    )}
                    {!isCompleted && !isFailed && batch.queued + batch.processing > 0 && (
                      <span>{batch.queued + batch.processing} in wachtrij</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {isStuck && !isRetrying && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          retryBatch(batch.batchId)
                        }}
                        className="flex items-center gap-1 text-primary hover:underline"
                      >
                        <RotateCw className="w-3 h-3" />
                        Opnieuw
                      </button>
                    )}
                    {isRetrying && (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Bezig...
                      </span>
                    )}
                    {batch.combinedPdfUrl && (
                      <a
                        href={batch.combinedPdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" />
                        PDF
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
