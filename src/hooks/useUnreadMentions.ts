'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const POLL_INTERVAL = 60000 // 60 seconds

export function useUnreadMentions(workerId: number | null) {
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  const fetchCount = useCallback(async () => {
    if (!workerId) return

    setIsLoading(true)
    try {
      const res = await fetch(`/api/verpakking/comments/unread-count?workerId=${workerId}`)
      if (res.ok) {
        const data = await res.json()
        if (isMountedRef.current) {
          setUnreadCount(data.count ?? 0)
        }
      }
    } catch {
      // silently fail — badge just won't update
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [workerId])

  useEffect(() => {
    isMountedRef.current = true

    if (workerId) {
      fetchCount()
      intervalRef.current = setInterval(fetchCount, POLL_INTERVAL)
    }

    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [workerId, fetchCount])

  return { unreadCount, isLoading, refetch: fetchCount }
}
