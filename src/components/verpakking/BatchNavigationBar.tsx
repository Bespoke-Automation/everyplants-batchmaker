'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, Layers, Loader2 } from 'lucide-react'
import type { BatchPicklistItem } from '@/types/verpakking'

interface BatchNavigationBarProps {
  batchDisplayId: string
  picklists: BatchPicklistItem[]
  currentSessionId: string
  onNavigate: (picklist: BatchPicklistItem) => void
  onBatchClick: () => void
  isNavigating?: boolean
}

export default function BatchNavigationBar({
  batchDisplayId,
  picklists,
  currentSessionId,
  onNavigate,
  onBatchClick,
  isNavigating,
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
    <div className="bg-muted/30 border-b border-border px-3 py-1.5 flex items-center justify-between gap-2 text-sm">
      {/* Left: batch info */}
      <button
        onClick={onBatchClick}
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors min-w-0 flex-shrink-0"
        title="Terug naar batch overzicht"
      >
        <Layers className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-medium">Batch {batchDisplayId}</span>
        <span className="hidden sm:inline text-xs">· {completedCount} van {picklists.length} afgerond</span>
      </button>

      {/* Right: picklist navigation */}
      <div className="flex items-center gap-1 min-w-0 flex-shrink-0">
        <button
          onClick={() => prevPicklist && onNavigate(prevPicklist)}
          disabled={!prevPicklist || isNavigating}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[28px] min-h-[28px] flex items-center justify-center"
          title={prevPicklist ? (prevPicklist.alias || prevPicklist.deliveryname || prevPicklist.picklistid) : undefined}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        {isNavigating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mx-1" />
        ) : (
          <>
            <span className="text-xs font-medium truncate max-w-[200px]" title={displayName}>
              {displayName}
            </span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              ({currentIndex + 1}/{picklists.length})
            </span>
          </>
        )}

        <button
          onClick={() => nextPicklist && onNavigate(nextPicklist)}
          disabled={!nextPicklist || isNavigating}
          className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed min-w-[28px] min-h-[28px] flex items-center justify-center"
          title={nextPicklist ? (nextPicklist.alias || nextPicklist.deliveryname || nextPicklist.picklistid) : undefined}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
