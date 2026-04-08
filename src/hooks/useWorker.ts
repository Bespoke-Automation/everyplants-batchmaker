'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
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
  // Same SWR key as usePicqerUsers → automatic deduplication (1 request)
  const { data, error, isLoading } = useSWR<{ users: PicqerUser[] }>(
    '/api/picqer/users',
    {
      revalidateOnFocus: false,
      dedupingInterval: 300_000,
    }
  )

  const workers = (data?.users ?? [])
    .filter((u) => u.active)
    .map(transformUserToWorker)

  // Restore selected worker from localStorage
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  // Validate stored worker still exists when worker list loads
  useEffect(() => {
    if (!selectedWorker || workers.length === 0) return
    const stillExists = workers.find((w) => w.iduser === selectedWorker.iduser)
    if (!stillExists) {
      setSelectedWorker(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [workers, selectedWorker])

  const selectWorker = useCallback((worker: Worker) => {
    setSelectedWorker(worker)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(worker))
    window.dispatchEvent(new CustomEvent('worker-changed', { detail: worker }))
  }, [])

  const clearWorker = useCallback(() => {
    setSelectedWorker(null)
    localStorage.removeItem(STORAGE_KEY)
    window.dispatchEvent(new CustomEvent('worker-changed', { detail: null }))
  }, [])

  return {
    workers,
    selectedWorker,
    isLoading,
    error: error ?? null,
    selectWorker,
    clearWorker,
  }
}
