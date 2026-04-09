'use client'

import { useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Layers, Loader2, ArrowLeft } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'
import type { BatchPicklistItem } from '@/types/verpakking'

interface BatchNavigationBarProps {
  batchDisplayId: string
  picklists: BatchPicklistItem[]
  currentPicklistId: number
  onNavigate: (picklist: BatchPicklistItem) => void
  onBatchClick: () => void
  onPrefetch?: (picklist: BatchPicklistItem) => void
  isNavigating?: boolean
  sessionCompleted?: boolean
}

export default function BatchNavigationBar({
  batchDisplayId,
  picklists,
  currentPicklistId,
  onNavigate,
  onBatchClick,
  onPrefetch,
  isNavigating,
  sessionCompleted,
}: BatchNavigationBarProps) {
  const { t } = useTranslation()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prefetchedRef = useRef<Set<number>>(new Set())

  const currentIndex = picklists.findIndex((pl) => pl.idpicklist === currentPicklistId)
  if (currentIndex === -1) return null

  const current = picklists[currentIndex]
  const completedCount = picklists.filter((pl) => pl.status === 'closed').length

  // Auto-skip completed picklists — check both Picqer status ('closed') and
  // packing session status ('completed') to handle stale cache and fallback paths
  const isCompleted = (pl: BatchPicklistItem) =>
    pl.status === 'closed' || pl.sessionStatus === 'completed'

  let prevPicklist: BatchPicklistItem | null = null
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (!isCompleted(picklists[i])) { prevPicklist = picklists[i]; break }
  }
  let nextPicklist: BatchPicklistItem | null = null
  for (let i = currentIndex + 1; i < picklists.length; i++) {
    if (!isCompleted(picklists[i])) { nextPicklist = picklists[i]; break }
  }

  const displayName = current.alias || current.deliveryname || current.picklistid

  // Prefetch on hover with 200ms delay to avoid accidental triggers
  const handleMouseEnter = useCallback((picklist: BatchPicklistItem | null) => {
    if (!picklist || !onPrefetch || !picklist.sessionId) return
    if (prefetchedRef.current.has(picklist.idpicklist)) return

    prefetchTimerRef.current = setTimeout(() => {
      prefetchedRef.current.add(picklist.idpicklist)
      onPrefetch(picklist)
    }, 200)
  }, [onPrefetch])

  const handleMouseLeave = useCallback(() => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current)
      prefetchTimerRef.current = null
    }
  }, [])

  return (
    <div className="bg-muted/40 border-b border-border px-3 py-2.5 flex items-center justify-between gap-3">
      {/* Left: back to batch + current picklist info */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onBatchClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors flex-shrink-0 min-h-[36px]"
          title={t.batch.backToBatchOverview}
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t.common.back}</span>
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          {isNavigating ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <>
              <span className="text-sm font-medium truncate max-w-[250px]" title={displayName}>
                {displayName}
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0 bg-muted border border-border px-1.5 py-0.5 rounded-full">
                {currentIndex + 1} / {picklists.length}
              </span>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                ({completedCount} {t.batch.completed})
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: picklist navigation */}
      <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => prevPicklist && onNavigate(prevPicklist)}
            onMouseEnter={() => handleMouseEnter(prevPicklist)}
            onMouseLeave={handleMouseLeave}
            onFocus={() => handleMouseEnter(prevPicklist)}
            onBlur={handleMouseLeave}
            disabled={!prevPicklist || isNavigating}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-[36px]"
            title={prevPicklist ? (prevPicklist.alias || prevPicklist.deliveryname || prevPicklist.picklistid) : undefined}
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{t.batch.previous}</span>
          </button>

          <button
            onClick={() => nextPicklist && onNavigate(nextPicklist)}
            onMouseEnter={() => handleMouseEnter(nextPicklist)}
            onMouseLeave={handleMouseLeave}
            onFocus={() => handleMouseEnter(nextPicklist)}
            onBlur={handleMouseLeave}
            disabled={!nextPicklist || isNavigating}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-[36px]"
            title={nextPicklist ? (nextPicklist.alias || nextPicklist.deliveryname || nextPicklist.picklistid) : undefined}
          >
            <span>{t.common.next}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
    </div>
  )
}
