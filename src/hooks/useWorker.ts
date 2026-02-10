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
const COOKIE_KEY = 'verpakking_worker_id'

function setCookie(name: string, value: string, days: number = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`
}

function removeCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

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
            removeCookie(COOKIE_KEY)
          }
        }
      } catch {
        // Invalid localStorage data, ignore
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
    setCookie(COOKIE_KEY, String(worker.iduser))
  }, [])

  const clearWorker = useCallback(() => {
    setSelectedWorker(null)
    localStorage.removeItem(STORAGE_KEY)
    removeCookie(COOKIE_KEY)
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
