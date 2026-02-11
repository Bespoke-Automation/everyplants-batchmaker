'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Worker } from '@/types/verpakking'

interface PicqerUser {
  iduser: number
  username: string
  firstname: string
  lastname: string
  emailaddress: string
  active: boolean
}

const STORAGE_KEY = 'verpakking_worker'

function transformUserToWorker(user: PicqerUser): Worker {
  return {
    iduser: user.iduser,
    firstname: user.firstname,
    lastname: user.lastname,
    fullName: `${user.firstname} ${user.lastname}`.trim(),
  }
}

export function useWorker() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchWorkers = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/picqer/users', { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch workers')
      }
      const responseData = await response.json()
      const transformedWorkers: Worker[] = (responseData.users ?? [])
        .filter((u: PicqerUser) => u.active)
        .map(transformUserToWorker)

      setWorkers(transformedWorkers)

      // Restore selected worker from localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored) {
          const parsed: Worker = JSON.parse(stored)
          const stillExists = transformedWorkers.find(
            (w) => w.iduser === parsed.iduser
          )
          if (stillExists) {
            setSelectedWorker(stillExists)
          } else {
            // Worker no longer exists, clean up
            localStorage.removeItem(STORAGE_KEY)
          }
        }
      } catch {
        // Invalid localStorage data, clean up
        localStorage.removeItem(STORAGE_KEY)
      }

      setIsLoading(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    fetchWorkers(abortController.signal)
    return () => abortController.abort()
  }, [fetchWorkers])

  const selectWorker = useCallback((worker: Worker) => {
    setSelectedWorker(worker)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(worker))
  }, [])

  const clearWorker = useCallback(() => {
    setSelectedWorker(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return {
    workers,
    selectedWorker,
    isLoading,
    error,
    selectWorker,
    clearWorker,
  }
}
