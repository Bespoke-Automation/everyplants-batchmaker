'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import useSWR from 'swr'
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
const COMMENT_POLL_INTERVAL = 30000

// Custom fetcher: parallel fetch batches + sessions, return enriched data
async function fetchBatchQueue(key: string): Promise<{
  batches: QueueBatch[]
  batchIds: number[]
  hasMore: boolean
}> {
  const url = new URL(key, window.location.origin)
  const statusFilter = url.searchParams.get('_statusFilter') || 'open'
  const completedLimit = parseInt(url.searchParams.get('_completedLimit') || '50', 10)

  // Remove internal params before passing to Picqer API
  url.searchParams.delete('_statusFilter')
  url.searchParams.delete('_completedLimit')
  url.searchParams.delete('_workerId')

  const [batchesRes, sessionsRes] = await Promise.all([
    fetch(url.pathname + '?' + url.searchParams.toString()),
    fetch('/api/verpakking/batch-sessions?active=true'),
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

  const sessionMap = new Map<number, BatchSession>()
  for (const session of activeSessions) {
    sessionMap.set(session.batch_id, session)
  }

  // Deduplicate
  const seen = new Set<number>()
  const uniqueBatches = rawBatches.filter((b) => {
    if (seen.has(b.idpicklist_batch)) return false
    seen.add(b.idpicklist_batch)
    return true
  })

  const enriched: QueueBatch[] = uniqueBatches.map((b) => {
    const session = sessionMap.get(b.idpicklist_batch)
    return {
      idpicklistBatch: b.idpicklist_batch,
      batchDisplayId: b.picklist_batchid,
      type: b.type,
      status: b.status,
      totalProducts: b.total_products,
      totalPicklists: b.total_picklists,
      createdAt: b.created_at,
      picqerAssignedTo: b.assigned_to?.full_name ?? null,
      totalComments: 0,
      isClaimed: !!session,
      claimedByName: session?.assigned_to_name,
      batchSessionId: session?.id,
    }
  })

  // Client-side status filter as safety net
  const statusFiltered = statusFilter === 'all'
    ? enriched
    : enriched.filter((b) => b.status === statusFilter)

  return {
    batches: statusFiltered,
    batchIds: statusFiltered.map((b) => b.idpicklistBatch),
    hasMore: statusFilter === 'completed' ? rawBatches.length >= completedLimit : false,
  }
}

export function useBatchQueue(workerId: number | null) {
  const [isClaiming, setIsClaiming] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'singles' | 'normal'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'completed'>('open')
  const [assignedToFilter, setAssignedToFilter] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [completedLimit, setCompletedLimit] = useState(50)
  const [commentCounts, setCommentCounts] = useState<Record<number, number>>({})

  // Build SWR key with all filter params
  const swrKey = useMemo(() => {
    if (!workerId) return null
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (statusFilter === 'completed') params.set('limit', completedLimit.toString())
    if (typeFilter !== 'all') params.set('type', typeFilter)
    if (assignedToFilter !== null) params.set('assigned_to_iduser', assignedToFilter.toString())
    // Internal params for the custom fetcher
    params.set('_statusFilter', statusFilter)
    params.set('_completedLimit', completedLimit.toString())
    params.set('_workerId', workerId.toString())
    return `/api/picqer/picklist-batches?${params}`
  }, [workerId, statusFilter, typeFilter, assignedToFilter, completedLimit])

  const { data, error, isLoading, mutate } = useSWR(
    swrKey,
    fetchBatchQueue,
    { refreshInterval: POLL_INTERVAL }
  )

  // Enrich batches with comment counts
  const batchesWithComments = useMemo(() => {
    if (!data?.batches) return []
    return data.batches.map((b) => ({
      ...b,
      totalComments: commentCounts[b.idpicklistBatch] ?? 0,
    }))
  }, [data?.batches, commentCounts])

  // Comment counts: separate SWR with longer interval
  const commentKey = useMemo(() => {
    if (!workerId || statusFilter === 'completed' || !data?.batchIds?.length) return null
    return `batch-comment-counts:${data.batchIds.join(',')}`
  }, [workerId, statusFilter, data?.batchIds])

  useSWR(
    commentKey,
    async () => {
      if (!data?.batchIds?.length) return
      const res = await fetch('/api/picqer/picklist-batches/comment-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchIds: data.batchIds }),
      })
      if (!res.ok) return
      const result = await res.json()
      if (result?.counts) {
        setCommentCounts(prev => ({ ...prev, ...result.counts }))
      }
    },
    { refreshInterval: COMMENT_POLL_INTERVAL, revalidateOnFocus: false }
  )

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

        const responseData = await response.json()

        if (!response.ok) {
          return { success: false, error: responseData.error || 'Failed to claim batch' }
        }

        await mutate()
        return { success: true, batchSessionId: responseData.id }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      } finally {
        setIsClaiming(false)
      }
    },
    [workerId, mutate]
  )

  const refetch = useCallback(() => mutate(), [mutate])

  const loadMoreCompleted = useCallback(() => {
    setCompletedLimit((prev) => prev + 50)
  }, [])

  // Reset completed limit when switching away from completed filter
  useEffect(() => {
    if (statusFilter !== 'completed') {
      setCompletedLimit(50)
    }
  }, [statusFilter])

  // Client-side search filter
  const filteredBatches = searchQuery.trim()
    ? batchesWithComments.filter((b) => {
        const q = searchQuery.toLowerCase()
        return (
          String(b.batchDisplayId).toLowerCase().includes(q) ||
          (b.picqerAssignedTo?.toLowerCase().includes(q) ?? false)
        )
      })
    : batchesWithComments

  return {
    batches: filteredBatches,
    totalBatches: batchesWithComments.length,
    isLoading,
    error: error ?? null,
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
    hasMoreCompleted: data?.hasMore ?? false,
    loadMoreCompleted,
  }
}
