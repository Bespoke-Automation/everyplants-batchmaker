'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, ChevronUp, Check, X, Webhook } from 'lucide-react'
import type { BatchCreation } from '@/types/database'

export interface BatchCreationResult {
  success: boolean
  batchId?: number
  picklistCount: number
  webhookTriggered: boolean
  ppsFilter: 'ja' | 'nee'
  errorMessage?: string
}

interface BatchCreationNotificationProps {
  latestResult?: BatchCreationResult | null
}

function formatRelativeTime(isoString: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return 'Zojuist'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min geleden`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} uur geleden`
  const days = Math.floor(hours / 24)
  return `${days} dag${days > 1 ? 'en' : ''} geleden`
}

export default function BatchCreationNotification({ latestResult }: BatchCreationNotificationProps) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const [sessionItems, setSessionItems] = useState<BatchCreation[]>([])
  const [historyItems, setHistoryItems] = useState<BatchCreation[]>([])
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevResultRef = useRef<BatchCreationResult | null>(null)

  // Fetch history from Supabase on mount
  useEffect(() => {
    async function fetchHistory() {
      try {
        const response = await fetch('/api/batches/history')
        if (response.ok) {
          const data = await response.json()
          setHistoryItems(data.creations || [])
        }
      } catch (error) {
        console.error('Error fetching batch history:', error)
      }
    }
    fetchHistory()
  }, [])

  // Refetch history after a new result is added (so it shows up in history on next page load)
  const refetchHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/batches/history')
      if (response.ok) {
        const data = await response.json()
        setHistoryItems(data.creations || [])
      }
    } catch (error) {
      console.error('Error refetching batch history:', error)
    }
  }, [])

  // When a new result comes in, add to session items and auto-expand
  useEffect(() => {
    if (!latestResult || latestResult === prevResultRef.current) return
    prevResultRef.current = latestResult

    const newItem: BatchCreation = {
      id: `session-${Date.now()}`,
      picqer_batch_id: latestResult.batchId ?? 0,
      picklist_count: latestResult.picklistCount,
      pps_filter: latestResult.ppsFilter,
      webhook_triggered: latestResult.webhookTriggered,
      status: latestResult.success ? 'success' : 'failed',
      error_message: latestResult.errorMessage ?? null,
      created_at: new Date().toISOString(),
    }

    setSessionItems(prev => [newItem, ...prev].slice(0, 5))
    setIsCollapsed(false)

    // Clear any existing auto-collapse timer
    if (autoCollapseTimer.current) {
      clearTimeout(autoCollapseTimer.current)
    }

    // Auto-collapse after 8 seconds
    autoCollapseTimer.current = setTimeout(() => {
      setIsCollapsed(true)
    }, 8000)

    // Refetch history so Supabase data stays fresh
    refetchHistory()

    return () => {
      if (autoCollapseTimer.current) {
        clearTimeout(autoCollapseTimer.current)
      }
    }
  }, [latestResult, refetchHistory])

  // Combine session items with history, deduplicate by picqer_batch_id
  const seenBatchIds = new Set<number>()
  const allItems: BatchCreation[] = []

  for (const item of sessionItems) {
    if (item.picqer_batch_id > 0 && seenBatchIds.has(item.picqer_batch_id)) continue
    if (item.picqer_batch_id > 0) seenBatchIds.add(item.picqer_batch_id)
    allItems.push(item)
  }
  for (const item of historyItems) {
    if (seenBatchIds.has(item.picqer_batch_id)) continue
    seenBatchIds.add(item.picqer_batch_id)
    allItems.push(item)
  }

  const displayItems = allItems.slice(0, 5)

  // Don't render if nothing to show
  if (displayItems.length === 0) {
    return null
  }

  const successCount = displayItems.filter(i => i.status === 'success').length
  const failCount = displayItems.filter(i => i.status === 'failed').length

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => {
          setIsCollapsed(!isCollapsed)
          // Cancel auto-collapse if user interacts
          if (autoCollapseTimer.current) {
            clearTimeout(autoCollapseTimer.current)
            autoCollapseTimer.current = null
          }
        }}
        className="w-full flex items-center justify-between p-3 bg-muted/50 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            Recente batches
          </span>
          <span className="text-xs text-muted-foreground">
            {successCount > 0 && (
              <span className="text-green-600">{successCount} gelukt</span>
            )}
            {successCount > 0 && failCount > 0 && ' / '}
            {failCount > 0 && (
              <span className="text-red-600">{failCount} mislukt</span>
            )}
          </span>
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
          {displayItems.map((item) => {
            const isSuccess = item.status === 'success'

            return (
              <div
                key={item.id}
                className={`p-3 border-t border-border ${
                  isSuccess ? 'bg-green-50/50' : 'bg-red-50/50'
                }`}
              >
                {/* Batch ID and status icon */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {isSuccess ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <X className="w-4 h-4 text-red-600" />
                    )}
                    <span className="font-medium text-sm">
                      {isSuccess
                        ? `Batch #${item.picqer_batch_id}`
                        : 'Batch mislukt'}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(item.created_at)}
                  </span>
                </div>

                {/* Details */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground ml-6">
                  <span>{item.picklist_count} picklists</span>
                  <span className="flex items-center gap-1">
                    <Webhook className="w-3 h-3" />
                    {item.webhook_triggered ? (
                      <span className="text-green-600">verstuurd</span>
                    ) : (
                      <span className="text-muted-foreground">niet verstuurd</span>
                    )}
                  </span>
                </div>

                {/* Error message */}
                {item.error_message && (
                  <div className="mt-1 ml-6 text-xs text-red-600 truncate" title={item.error_message}>
                    {item.error_message}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
