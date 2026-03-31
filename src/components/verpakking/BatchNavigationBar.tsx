'use client'

import { ChevronLeft, ChevronRight, Layers, Loader2, ArrowLeft } from 'lucide-react'
import type { BatchPicklistItem } from '@/types/verpakking'

interface BatchNavigationBarProps {
  batchDisplayId: string
  picklists: BatchPicklistItem[]
  currentSessionId: string
  onNavigate: (picklist: BatchPicklistItem) => void
  onBatchClick: () => void
  isNavigating?: boolean
  sessionCompleted?: boolean
}

export default function BatchNavigationBar({
  batchDisplayId,
  picklists,
  currentSessionId,
  onNavigate,
  onBatchClick,
  isNavigating,
  sessionCompleted,
}: BatchNavigationBarProps) {
  const currentIndex = picklists.findIndex((pl) => pl.sessionId === currentSessionId)
  if (currentIndex === -1) return null

  const current = picklists[currentIndex]
  const completedCount = picklists.filter(
    (pl) => pl.sessionStatus === 'completed' || pl.status === 'closed'
  ).length

  const prevPicklist = currentIndex > 0 ? picklists[currentIndex - 1] : null
  const nextPicklist = currentIndex < picklists.length - 1 ? picklists[currentIndex + 1] : null

  const displayName = current.alias || current.deliveryname || current.picklistid

  return (
    <div className="bg-muted/40 border-b border-border px-3 py-2.5 flex items-center justify-between gap-3">
      {/* Left: back to batch + current picklist info */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onBatchClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors flex-shrink-0 min-h-[36px]"
          title="Terug naar batch overzicht"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Terug</span>
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
                ({completedCount} afgerond)
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: picklist navigation */}
      <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => prevPicklist && onNavigate(prevPicklist)}
            disabled={!prevPicklist || isNavigating}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-[36px]"
            title={prevPicklist ? (prevPicklist.alias || prevPicklist.deliveryname || prevPicklist.picklistid) : undefined}
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Vorige</span>
          </button>

          <button
            onClick={() => nextPicklist && onNavigate(nextPicklist)}
            disabled={!nextPicklist || isNavigating}
            className="inline-flex items-center gap-1 px-4 py-1.5 text-sm font-medium rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-h-[36px]"
            title={nextPicklist ? (nextPicklist.alias || nextPicklist.deliveryname || nextPicklist.picklistid) : undefined}
          >
            <span>Volgende</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
    </div>
  )
}
