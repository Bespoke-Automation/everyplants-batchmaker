'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { QueueBatch, BatchClaimResult } from '@/types/verpakking'

interface PicqerBatch {
  idpicklist_batch: number
  picklist_batchid: string
  type: 'singles' | 'normal'
  status: string
  assigned_to: { iduser: number; full_name: string } | null
  total_products: number
  total_picklists: number
  created_at: string
}

interface BatchSession {
  id: string
  batch_id: number
  assigned_to: number
  assigned_to_name: string
  status: string
}

const POLL_INTERVAL = 5000
const COMMENT_POLL_INTERVAL = 30000 // Comment counts refresh every 30s

export function useBatchQueue(workerId: number | null) {
  const [batches, setBatches] = useState<QueueBatch[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'singles' | 'normal'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('open')
  const [assignedToFilter, setAssignedToFilter] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const commentIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  const commentCountsRef = useRef<Record<number, number>>({})
  const batchIdsRef = useRef<number[]>([])

  const fetchQueue = useCallback(async (signal?: AbortSignal) => {
    if (!workerId) return

    try {
      // Build query params
      const params = new URLSearchParams()
      if (statusFilter !== 'all') {
        params.set('status', statusFilter)
      }
      if (typeFilter !== 'all') {
        params.set('type', typeFilter)
      }
      if (assignedToFilter !== null) {
        params.set('assigned_to_iduser', assignedToFilter.toString())
      }

      // Fetch batches and active batch sessions in parallel
      const [batchesRes, sessionsRes] = await Promise.all([
        fetch(`/api/picqer/picklist-batches?${params}`, { signal }),
        fetch('/api/verpakking/batch-sessions?active=true', { signal }),
      ])

      if (!batchesRes.ok) {
        const errorData = await batchesRes.json()
        throw new Error(errorData.error || 'Failed to fetch batches')
      }

      const batchesData = await batchesRes.json()
      const rawBatches: PicqerBatch[] = batchesData.batches ?? []

      let activeSessions: BatchSession[] = []
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json()
        activeSessions = sessionsData.sessions ?? []
      }

      // Build a map of batch_id → session
      const sessionMap = new Map<number, BatchSession>()
      for (const session of activeSessions) {
        sessionMap.set(session.batch_id, session)
      }

      // Deduplicate batches
      const seen = new Set<number>()
      const uniqueBatches = rawBatches.filter((b) => {
        if (seen.has(b.idpicklist_batch)) return false
        seen.add(b.idpicklist_batch)
        return true
      })

      // Transform and enrich
      const enriched: QueueBatch[] = uniqueBatches.map((b) => {
        const session = sessionMap.get(b.idpicklist_batch)
        const isClaimedByMe = session?.assigned_to === workerId
        return {
          idpicklistBatch: b.idpicklist_batch,
          batchDisplayId: b.picklist_batchid,
          type: b.type,
          status: b.status,
          totalProducts: b.total_products,
          totalPicklists: b.total_picklists,
          createdAt: b.created_at,
          picqerAssignedTo: b.assigned_to?.full_name ?? null,
          totalComments: commentCountsRef.current[b.idpicklist_batch] ?? 0,
          isClaimed: !!session,
          claimedByName: session?.assigned_to_name,
          batchSessionId: isClaimedByMe ? session?.id : undefined,
        }
      })

      if (isMountedRef.current) {
        batchIdsRef.current = enriched.map((b) => b.idpicklistBatch)
        setBatches(enriched)
        setError(null)
        setIsLoading(false)
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (isMountedRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
        setIsLoading(false)
      }
    }
  }, [workerId, typeFilter, statusFilter, assignedToFilter])

  // Fetch comment counts for all current batches
  const fetchCommentCounts = useCallback(async () => {
    if (!workerId || batchIdsRef.current.length === 0) return

    try {
      const res = await fetch('/api/picqer/picklist-batches/comment-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: batchIdsRef.current }),
      })
      if (!res.ok || !isMountedRef.current) return
      const data = await res.json()
      if (!data?.counts) return

      commentCountsRef.current = { ...commentCountsRef.current, ...data.counts }
      setBatches((prev) =>
        prev.map((b) => ({
          ...b,
          totalComments: commentCountsRef.current[b.idpicklistBatch] ?? 0,
        }))
      )
    } catch {
      // Silently ignore comment count errors
    }
  }, [workerId])

  // Initial fetch
  useEffect(() => {
    if (!workerId) {
      setBatches([])
      setIsLoading(false)
      return
    }

    isMountedRef.current = true
    const abortController = new AbortController()
    fetchQueue(abortController.signal)

    return () => {
      isMountedRef.current = false
      abortController.abort()
    }
  }, [fetchQueue, workerId])

  // Fetch comment counts after batches are loaded
  useEffect(() => {
    if (!workerId || isLoading || batches.length === 0) return
    // Only fetch if we haven't fetched yet (all counts are 0)
    const hasAnyCounts = batches.some((b) => b.totalComments > 0)
    if (!hasAnyCounts && Object.keys(commentCountsRef.current).length === 0) {
      fetchCommentCounts()
    }
  }, [workerId, isLoading, batches.length, fetchCommentCounts])

  // Polling with Page Visibility API
  useEffect(() => {
    if (!workerId) return

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        fetchQueue()
      }, POLL_INTERVAL)

      // Comment counts poll less frequently
      if (commentIntervalRef.current) clearInterval(commentIntervalRef.current)
      commentIntervalRef.current = setInterval(() => {
        fetchCommentCounts()
      }, COMMENT_POLL_INTERVAL)
    }

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (commentIntervalRef.current) {
        clearInterval(commentIntervalRef.current)
        commentIntervalRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        fetchQueue()
        fetchCommentCounts()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchQueue, fetchCommentCounts, workerId])

  const claimBatch = useCallback(
    async (batchId: number, batchDisplayId: string, totalPicklists: number, workerName: string): Promise<BatchClaimResult> => {
      setIsClaiming(true)
      try {
        const response = await fetch('/api/verpakking/batch-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batchId,
            batchDisplayId,
            totalPicklists,
            assignedTo: workerId,
            assignedToName: workerName,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to claim batch' }
        }

        // Trigger refetch to update claim status
        await fetchQueue()

        return { success: true, batchSessionId: data.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      } finally {
        setIsClaiming(false)
      }
    },
    [workerId, fetchQueue]
  )

  const refetch = useCallback(() => fetchQueue(), [fetchQueue])

  // Client-side search filter
  const filteredBatches = searchQuery.trim()
    ? batches.filter((b) => {
        const q = searchQuery.toLowerCase()
        return (
          String(b.batchDisplayId).toLowerCase().includes(q) ||
          (b.picqerAssignedTo?.toLowerCase().includes(q) ?? false)
        )
      })
    : batches

  return {
    batches: filteredBatches,
    totalBatches: batches.length,
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
  }
}
