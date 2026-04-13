'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { BatchSessionDetail, BatchPicklistItem, BatchProduct } from '@/types/verpakking'

interface BatchSessionResponse {
  id: string
  batch_id: number
  batch_display_id: string
  total_picklists: number
  completed_picklists: number
  assigned_to: number
  assigned_to_name: string
  status: string
  packing_sessions: {
    id: string
    picklist_id: number
    picklistid: string
    status: string
  }[]
}

interface PicqerBatchPicklist {
  idpicklist: number
  picklistid: string
  delivery_name: string
  reference: string | null
  alias: string | null
  total_products: number
  status: string
  has_notes: boolean
  has_customer_remarks: boolean
  customer_remarks: string | null
}

interface PicqerBatchProductPicklist {
  idpicklist: number
  amount: number
  amount_picked: number
  amount_collected: number
}

interface PicqerBatchProduct {
  idproduct: number
  name: string
  productcode: string
  image: string | null
  stock_location: string | null
  amount?: number
  amount_picked?: number
  picklists: PicqerBatchProductPicklist[]
}

export interface BatchComment {
  idcomment: number
  body: string
  authorType: string
  authorName: string
  authorImageUrl: string | null
  createdAt: string
}

const POLL_INTERVAL = 10000

interface PicqerBatchDetail {
  picklists?: PicqerBatchPicklist[]
  products?: PicqerBatchProduct[]
  type?: 'singles' | 'normal'
  total_products?: number
  total_picklists?: number
  picklist_batchid?: string
  assigned_to?: { iduser: number; full_name: string }
}

export function useBatchSession(batchSessionId: string | null, previewBatchId?: number | null) {
  const [batchSession, setBatchSession] = useState<BatchSessionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isStartingPicklist, setIsStartingPicklist] = useState(false)
  const [comments, setComments] = useState<BatchComment[]>([])
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [picklistComments, setPicklistComments] = useState<Record<number, BatchComment[]>>({})
  const [isLoadingPicklistComments, setIsLoadingPicklistComments] = useState(false)
  const picklistCommentsLoadedRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)
  // Smart polling: track last known status to avoid unnecessary re-renders
  const lastKnownStatusRef = useRef<{ status: string; completedPicklists: number } | null>(null)
  // Cache Picqer data between light polls (only re-fetched on full fetch)
  const lastPicqerDataRef = useRef<{
    rawPicklists: PicqerBatchPicklist[]
    rawProducts: PicqerBatchProduct[]
    batchType: 'singles' | 'normal'
    totalProducts: number
    picqerTotalPicklists: number
  } | null>(null)

  // Helper: map raw Picqer products to BatchProduct[]
  const mapProducts = (rawProducts: PicqerBatchProduct[]): BatchProduct[] =>
    rawProducts.map((p) => {
      const plArray = p.picklists ?? []
      // Primary: sum from nested picklists array
      let totalAmount = plArray.reduce((sum, pl) => sum + (pl.amount ?? 0), 0)
      let totalPicked = plArray.reduce((sum, pl) => sum + (pl.amount_picked ?? 0), 0)
      // Fallback: use top-level amount/amount_picked if picklists array is empty
      if (totalAmount === 0 && p.amount) totalAmount = p.amount
      if (totalPicked === 0 && p.amount_picked) totalPicked = p.amount_picked
      return {
        idproduct: p.idproduct,
        productcode: p.productcode ?? '',
        name: p.name ?? '',
        image: p.image ?? null,
        stockLocation: p.stock_location ?? null,
        amount: totalAmount,
        amountPicked: totalPicked,
        picklistAllocations: plArray.map(pl => ({ idpicklist: pl.idpicklist, amount: pl.amount ?? 0 })),
      }
    })

  // Helper: map raw Picqer picklists to BatchPicklistItem[] (without session linkage)
  const mapPicklists = (rawPicklists: PicqerBatchPicklist[]): BatchPicklistItem[] =>
    rawPicklists.map((pl) => ({
      idpicklist: pl.idpicklist,
      picklistid: pl.picklistid,
      alias: pl.alias ?? null,
      deliveryname: pl.delivery_name,
      reference: pl.reference,
      totalproducts: pl.total_products,
      status: pl.status,
      hasNotes: pl.has_notes,
      hasCustomerRemarks: pl.has_customer_remarks,
      customerRemarks: pl.customer_remarks,
    }))

  const fetchBatchSession = useCallback(async (signal?: AbortSignal, isPolling = false) => {
    // Preview mode: load only from Picqer without Supabase session
    if (!batchSessionId && previewBatchId) {
      try {
        const batchDetailRes = await fetch(`/api/picqer/picklist-batches/${previewBatchId}`, { signal })

        if (!batchDetailRes.ok) {
          const errorData = await batchDetailRes.json()
          throw new Error(errorData.error || 'Failed to fetch batch details')
        }

        const batchDetail = await batchDetailRes.json()
        const rawPicklists: PicqerBatchPicklist[] = batchDetail.picklists ?? []
        const rawProducts: PicqerBatchProduct[] = batchDetail.products ?? []

        const detail: BatchSessionDetail = {
          id: '',
          batchId: previewBatchId,
          batchDisplayId: batchDetail.picklist_batchid || String(previewBatchId),
          totalPicklists: rawPicklists.length || batchDetail.total_picklists || 0,
          completedPicklists: 0,
          totalProducts: batchDetail.total_products ?? 0,
          batchType: batchDetail.type ?? 'normal',
          status: 'preview',
          assignedTo: batchDetail.assigned_to?.iduser ?? 0,
          assignedToName: batchDetail.assigned_to?.full_name ?? '',
          picklists: mapPicklists(rawPicklists),
          products: mapProducts(rawProducts),
        }

        if (isMountedRef.current) {
          setBatchSession(detail)
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
      return
    }

    if (!batchSessionId) return

    try {
      // Single call that fetches Supabase session + Picqer batch details server-side in parallel
      const includePicqer = !isPolling
      const url = `/api/verpakking/batch-sessions/${batchSessionId}${includePicqer ? '?include=picqer' : ''}`
      const batchSessionRes = await fetch(url, { signal })

      if (!batchSessionRes.ok) {
        const errorData = await batchSessionRes.json()
        throw new Error(errorData.error || 'Failed to fetch batch session')
      }

      const sessionData = await batchSessionRes.json() as BatchSessionResponse & { picqer_batch?: PicqerBatchDetail | null }

      // Smart polling: if status hasn't changed, skip the expensive UI update
      if (isPolling && lastKnownStatusRef.current) {
        const statusUnchanged =
          sessionData.status === lastKnownStatusRef.current.status &&
          sessionData.completed_picklists === lastKnownStatusRef.current.completedPicklists
        if (statusUnchanged) return // No changes — skip re-render
      }

      // Extract Picqer data (from combined response, or use cached)
      let rawPicklists: PicqerBatchPicklist[] = []
      let rawProducts: PicqerBatchProduct[] = []
      let batchType: 'singles' | 'normal' = 'normal'
      let totalProducts = 0
      let picqerTotalPicklists = 0

      const picqerBatch = sessionData.picqer_batch
      if (picqerBatch) {
        rawPicklists = picqerBatch.picklists ?? []
        rawProducts = picqerBatch.products ?? []
        batchType = picqerBatch.type ?? 'normal'
        totalProducts = picqerBatch.total_products ?? 0
        picqerTotalPicklists = picqerBatch.total_picklists ?? 0
        // Cache Picqer data for light polls
        lastPicqerDataRef.current = { rawPicklists, rawProducts, batchType, totalProducts, picqerTotalPicklists }
      } else if (lastPicqerDataRef.current) {
        // Light poll: reuse cached Picqer data
        ;({ rawPicklists, rawProducts, batchType, totalProducts, picqerTotalPicklists } = lastPicqerDataRef.current)
      }

      // Build a map of picklist_id → packing session
      const packingSessionMap = new Map<number, { id: string; status: string }>()
      for (const ps of sessionData.packing_sessions || []) {
        packingSessionMap.set(ps.picklist_id, { id: ps.id, status: ps.status })
      }

      // Enrich picklists with packing session info + alias
      const picklists: BatchPicklistItem[] = rawPicklists.map((pl) => {
        const ps = packingSessionMap.get(pl.idpicklist)
        return {
          idpicklist: pl.idpicklist,
          picklistid: pl.picklistid,
          alias: pl.alias ?? null,
          deliveryname: pl.delivery_name,
          reference: pl.reference,
          totalproducts: pl.total_products,
          status: pl.status,
          hasNotes: pl.has_notes,
          hasCustomerRemarks: pl.has_customer_remarks,
          customerRemarks: pl.customer_remarks,
          sessionId: ps?.id,
          sessionStatus: ps?.status,
        }
      })

      const products = mapProducts(rawProducts)

      // Use live Picqer count (rawPicklists.length or total_picklists) — Supabase value may be stale
      const actualTotalPicklists = rawPicklists.length || picqerTotalPicklists || sessionData.total_picklists

      const detail: BatchSessionDetail = {
        id: sessionData.id,
        batchId: sessionData.batch_id,
        batchDisplayId: sessionData.batch_display_id || String(sessionData.batch_id),
        totalPicklists: actualTotalPicklists,
        completedPicklists: sessionData.completed_picklists,
        totalProducts,
        batchType,
        status: sessionData.status,
        assignedTo: sessionData.assigned_to,
        assignedToName: sessionData.assigned_to_name,
        picklists,
        products,
      }

      if (isMountedRef.current) {
        setBatchSession(detail)
        lastKnownStatusRef.current = { status: sessionData.status, completedPicklists: sessionData.completed_picklists }
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
  }, [batchSessionId, previewBatchId])

  // Initial fetch
  useEffect(() => {
    if (!batchSessionId && !previewBatchId) {
      setBatchSession(null)
      setIsLoading(false)
      return
    }

    isMountedRef.current = true
    const abortController = new AbortController()
    fetchBatchSession(abortController.signal)

    return () => {
      isMountedRef.current = false
      abortController.abort()
    }
  }, [fetchBatchSession, batchSessionId, previewBatchId])

  // Polling
  useEffect(() => {
    if (!batchSessionId && !previewBatchId) return

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        fetchBatchSession(undefined, true)
      }, POLL_INTERVAL)
    }

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        fetchBatchSession()
        startPolling()
      }
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchBatchSession, batchSessionId, previewBatchId])

  /**
   * Start a picklist within this batch: create a packing session linked to the batch session
   */
  const startPicklist = useCallback(
    async (picklistId: number, workerId: number, workerName: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
      if (!batchSessionId) return { success: false, error: 'No batch session' }

      setIsStartingPicklist(true)
      try {
        const response = await fetch('/api/verpakking/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            picklistId,
            assignedTo: workerId,
            assignedToName: workerName,
            batchSessionId,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to start picklist' }
        }

        // Update batch session status to in_progress if still claimed
        if (batchSession?.status === 'claimed') {
          fetch(`/api/verpakking/batch-sessions/${batchSessionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'in_progress' }),
          }).catch(err => console.error('Failed to update batch session status:', err))
        }

        // Optimistic update: mark picklist as active locally instead of refetching entire batch from Picqer
        setBatchSession(prev => {
          if (!prev) return prev
          return {
            ...prev,
            status: prev.status === 'claimed' ? 'in_progress' : prev.status,
            picklists: prev.picklists.map(pl =>
              pl.idpicklist === picklistId
                ? { ...pl, sessionId: data.id, sessionStatus: 'active' }
                : pl
            ),
          }
        })

        return { success: true, sessionId: data.id }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      } finally {
        setIsStartingPicklist(false)
      }
    },
    [batchSessionId, batchSession?.status]
  )

  /**
   * Mark a picklist as completed within this batch
   */
  const completePicklist = useCallback(async (): Promise<void> => {
    if (!batchSessionId || !batchSession) return

    try {
      const newCount = batchSession.completedPicklists + 1
      const isComplete = newCount >= batchSession.totalPicklists

      await fetch(`/api/verpakking/batch-sessions/${batchSessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completedPicklists: newCount,
          status: isComplete ? 'completed' : 'in_progress',
        }),
      })

      // Optimistic update instead of refetching entire batch from Picqer
      setBatchSession(prev => {
        if (!prev) return prev
        return {
          ...prev,
          completedPicklists: newCount,
          status: isComplete ? 'completed' : 'in_progress',
        }
      })
    } catch (err) {
      console.error('Error completing picklist in batch:', err)
    }
  }, [batchSessionId, batchSession])

  /**
   * Download batch PDF and open in new tab
   */
  const downloadPdf = useCallback(async (): Promise<void> => {
    if (!batchSession) return

    try {
      const response = await fetch(`/api/picqer/picklist-batches/${batchSession.batchId}/pdf`)

      if (!response.ok) {
        throw new Error('Failed to fetch PDF')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')

      // Clean up after a delay
      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      console.error('Error downloading batch PDF:', err)
    }
  }, [batchSession])

  /**
   * Download packing list PDF (pakbonnen) for all picklists in the batch
   */
  const downloadPackingListPdf = useCallback(async (): Promise<void> => {
    if (!batchSession || batchSession.picklists.length === 0) return

    try {
      const picklistIds = batchSession.picklists.map((pl) => pl.idpicklist).join(',')
      const response = await fetch(
        `/api/picqer/picklists/packinglistpdf?idpicklist=${picklistIds}&show_aliases=1`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch packing list PDF')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')

      setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (err) {
      console.error('Error downloading packing list PDF:', err)
    }
  }, [batchSession])

  /**
   * Add a picklist to the batch
   */
  const addPicklist = useCallback(async (picklistId: number): Promise<{ success: boolean; error?: string }> => {
    if (!batchSession) return { success: false, error: 'No batch session' }

    try {
      const response = await fetch(
        `/api/picqer/picklist-batches/${batchSession.batchId}/picklists`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ picklistId }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to add picklist' }
      }

      await fetchBatchSession()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [batchSession, fetchBatchSession])

  /**
   * Remove a picklist from the batch
   */
  const removePicklist = useCallback(async (picklistId: number): Promise<{ success: boolean; error?: string }> => {
    if (!batchSession) return { success: false, error: 'No batch session' }

    try {
      const response = await fetch(
        `/api/picqer/picklist-batches/${batchSession.batchId}/picklists/${picklistId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to remove picklist' }
      }

      await fetchBatchSession()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [batchSession, fetchBatchSession])

  /**
   * Delete the batch in Picqer and mark our session as completed
   */
  const deleteBatch = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!batchSession) return { success: false, error: 'No batch session' }

    try {
      const response = await fetch(
        `/api/picqer/picklist-batches/${batchSession.batchId}`,
        { method: 'DELETE' }
      )

      if (!response.ok) {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to delete batch' }
      }

      // Mark our batch session as completed
      if (batchSessionId) {
        await fetch(`/api/verpakking/batch-sessions/${batchSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        })
      }

      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [batchSession, batchSessionId])

  /**
   * Fetch comments for this batch
   */
  const fetchComments = useCallback(async () => {
    if (!batchSession) return

    setIsLoadingComments(true)
    try {
      const response = await fetch(`/api/picqer/picklist-batches/${batchSession.batchId}/comments`)
      if (response.ok) {
        const data = await response.json()
        const mapped: BatchComment[] = (data.comments ?? []).map((c: { idcomment: number; body: string; author_type: string; author: { full_name: string; image_url: string | null }; created_at: string }) => ({
          idcomment: c.idcomment,
          body: c.body,
          authorType: c.author_type,
          authorName: c.author?.full_name ?? 'Onbekend',
          authorImageUrl: c.author?.image_url ?? null,
          createdAt: c.created_at,
        }))
        if (isMountedRef.current) setComments(mapped)
      }
    } catch {
      // silently fail
    } finally {
      if (isMountedRef.current) setIsLoadingComments(false)
    }
  }, [batchSession])

  /**
   * Fetch comments for all picklists in this batch
   */
  const fetchPicklistComments = useCallback(async () => {
    if (!batchSession || batchSession.picklists.length === 0) return

    setIsLoadingPicklistComments(true)
    try {
      const picklistIds = batchSession.picklists.map((pl) => pl.idpicklist)
      const response = await fetch('/api/picqer/picklists/comments-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picklistIds }),
      })

      if (response.ok) {
        const data = await response.json()
        const rawComments: Record<string, Array<{ idcomment: number; body: string; author_type: string; author: { full_name: string; image_url: string | null }; created_at: string }>> = data.comments ?? {}
        const mapped: Record<number, BatchComment[]> = {}

        for (const [picklistId, comments] of Object.entries(rawComments)) {
          mapped[Number(picklistId)] = comments.map((c) => ({
            idcomment: c.idcomment,
            body: c.body,
            authorType: c.author_type,
            authorName: c.author?.full_name ?? 'Onbekend',
            authorImageUrl: c.author?.image_url ?? null,
            createdAt: c.created_at,
          }))
        }

        if (isMountedRef.current) setPicklistComments(mapped)
      }
    } catch {
      // silently fail
    } finally {
      if (isMountedRef.current) setIsLoadingPicklistComments(false)
    }
  }, [batchSession])

  /**
   * Add a comment to this batch
   */
  const addBatchComment = useCallback(async (body: string): Promise<{ success: boolean; error?: string }> => {
    if (!batchSession) return { success: false, error: 'No batch session' }

    try {
      const response = await fetch(`/api/picqer/picklist-batches/${batchSession.batchId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })

      if (!response.ok) {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to add comment' }
      }

      // Refetch comments
      await fetchComments()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [batchSession, fetchComments])

  /**
   * Delete a comment from this batch
   */
  const deleteBatchComment = useCallback(async (idcomment: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const response = await fetch(`/api/picqer/comments/${idcomment}`, {
        method: 'DELETE',
      })

      if (!response.ok && response.status !== 204) {
        const data = await response.json().catch(() => ({}))
        return { success: false, error: (data as { error?: string }).error || 'Failed to delete comment' }
      }

      await fetchComments()
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [fetchComments])

  const reassignBatch = useCallback(
    async (userId: number, userName: string): Promise<{ success: boolean; error?: string }> => {
      if (!batchSession) return { success: false, error: 'No batch session' }

      try {
        const response = await fetch(
          `/api/picqer/picklist-batches/${batchSession.batchId}/assign`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
          }
        )

        if (!response.ok) {
          const data = await response.json()
          return { success: false, error: data.error || 'Failed to reassign batch' }
        }

        // Update Supabase session record
        await fetch(`/api/verpakking/batch-sessions/${batchSession.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigned_to: userId, assigned_to_name: userName }),
        })

        // Refresh data
        await fetchBatchSession()
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
    [batchSession, fetchBatchSession]
  )

  /**
   * Unassign the batch: remove user in Picqer + mark Supabase session as completed
   */
  const unassignBatch = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    if (!batchSession) return { success: false, error: 'No batch session' }

    try {
      // Unassign in Picqer (send null userId)
      const response = await fetch(
        `/api/picqer/picklist-batches/${batchSession.batchId}/assign`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: null }),
        }
      )

      if (!response.ok) {
        const data = await response.json()
        return { success: false, error: data.error || 'Failed to unassign batch in Picqer' }
      }

      // Mark Supabase session as completed (releases claim)
      if (batchSessionId) {
        await fetch(`/api/verpakking/batch-sessions/${batchSessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' }),
        })
      }

      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { success: false, error: message }
    }
  }, [batchSession, batchSessionId])

  const refetch = useCallback(() => fetchBatchSession(), [fetchBatchSession])

  // Auto-fetch picklist comments when batch session loads
  useEffect(() => {
    if (batchSession && !picklistCommentsLoadedRef.current) {
      picklistCommentsLoadedRef.current = true
      fetchPicklistComments()
    }
  }, [batchSession, fetchPicklistComments])

  return {
    batchSession,
    isLoading,
    error,
    isStartingPicklist,
    startPicklist,
    completePicklist,
    downloadPdf,
    downloadPackingListPdf,
    addPicklist,
    removePicklist,
    deleteBatch,
    reassignBatch,
    unassignBatch,
    comments,
    isLoadingComments,
    fetchComments,
    addBatchComment,
    deleteBatchComment,
    picklistComments,
    isLoadingPicklistComments,
    fetchPicklistComments,
    refetch,
  }
}
