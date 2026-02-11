'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { QueuePicklist, ClaimResult } from '@/types/verpakking'

interface PicqerPicklist {
  idpicklist: number
  picklistid: string
  idorder: number
  deliveryname: string
  deliverycountry: string
  totalproducts: number
  totalpicked: number
  status: string
  tags?: { idtag: number; title: string; color?: string }[]
  urgent: boolean
  preferred_delivery_date: string | null
  created: string
}

interface PackingSession {
  id: string
  picklist_id: number
  assigned_to_name: string
  status: string
}

const POLL_INTERVAL = 5000

export function usePicklistQueue(workerId: number | null) {
  const [picklists, setPicklists] = useState<QueuePicklist[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isClaiming, setIsClaiming] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  const fetchQueue = useCallback(async (signal?: AbortSignal) => {
    if (!workerId) return

    try {
      // Fetch picklists and sessions in parallel
      const [picklistsRes, sessionsRes] = await Promise.all([
        fetch('/api/picqer/picklists?status=new&limit=200', { signal }),
        fetch('/api/verpakking/sessions?limit=50', { signal }),
      ])

      if (!picklistsRes.ok) {
        const errorData = await picklistsRes.json()
        throw new Error(errorData.error || 'Failed to fetch picklists')
      }

      const picklistsData = await picklistsRes.json()
      const rawPicklists: PicqerPicklist[] = picklistsData.picklists ?? []

      // Sessions may not exist yet (404 is ok)
      let activeSessions: PackingSession[] = []
      if (sessionsRes.ok) {
        const sessionsData = await sessionsRes.json()
        activeSessions = (sessionsData.sessions ?? []).filter(
          (s: PackingSession) => s.status !== 'completed' && s.status !== 'failed'
        )
      }

      // Build a map of picklist_id → session for quick lookup
      const sessionMap = new Map<number, PackingSession>()
      for (const session of activeSessions) {
        sessionMap.set(session.picklist_id, session)
      }

      // Deduplicate picklists (Picqer pagination can return duplicates)
      const seen = new Set<number>()
      const uniquePicklists = rawPicklists.filter((pl) => {
        if (seen.has(pl.idpicklist)) return false
        seen.add(pl.idpicklist)
        return true
      })

      // Transform and enrich picklists
      const enriched: QueuePicklist[] = uniquePicklists.map((pl) => {
        const session = sessionMap.get(pl.idpicklist)
        return {
          idpicklist: pl.idpicklist,
          picklistid: pl.picklistid,
          idorder: pl.idorder,
          deliveryname: pl.deliveryname,
          deliverycountry: pl.deliverycountry,
          totalproducts: pl.totalproducts,
          totalpicked: pl.totalpicked,
          status: pl.status,
          tags: (pl.tags ?? []).map((t) => t.title),
          urgent: pl.urgent,
          preferred_delivery_date: pl.preferred_delivery_date,
          created: pl.created,
          isClaimed: !!session,
          claimedByName: session?.assigned_to_name,
        }
      })

      if (isMountedRef.current) {
        setPicklists(enriched)
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
  }, [workerId])

  // Initial fetch
  useEffect(() => {
    if (!workerId) {
      setPicklists([])
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

  // Polling with Page Visibility API
  useEffect(() => {
    if (!workerId) return

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        fetchQueue()
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
        // Immediate fetch when tab becomes visible again
        fetchQueue()
        startPolling()
      }
    }

    // Start polling immediately
    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchQueue, workerId])

  const claimPicklist = useCallback(
    async (picklistId: number, workerName: string): Promise<ClaimResult> => {
      setIsClaiming(true)
      try {
        const response = await fetch('/api/verpakking/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            picklistId,
            assignedTo: workerId,
            assignedToName: workerName,
          }),
        })

        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to claim picklist' }
        }

        // Trigger refetch to update claim status
        await fetchQueue()

        return { success: true, sessionId: data.id }
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

  return {
    picklists,
    isLoading,
    error,
    isClaiming,
    claimPicklist,
    refetch,
  }
}
