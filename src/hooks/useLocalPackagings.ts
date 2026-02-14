'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LocalPackaging } from '@/types/verpakking'

interface ApiLocalPackaging {
  id: string
  idpackaging: number
  name: string
  barcode: string | null
  length: number | null
  width: number | null
  height: number | null
  max_weight: number | null
  box_category: string | null
  specificity_score: number
  handling_cost: number
  material_cost: number
  use_in_auto_advice: boolean
  active: boolean
  last_synced_at: string
}

function transformPackaging(raw: ApiLocalPackaging): LocalPackaging {
  return {
    id: raw.id,
    idpackaging: raw.idpackaging,
    name: raw.name,
    barcode: raw.barcode,
    length: raw.length,
    width: raw.width,
    height: raw.height,
    maxWeight: raw.max_weight,
    boxCategory: raw.box_category,
    specificityScore: raw.specificity_score,
    handlingCost: raw.handling_cost,
    materialCost: raw.material_cost,
    useInAutoAdvice: raw.use_in_auto_advice,
    active: raw.active,
    lastSyncedAt: raw.last_synced_at,
  }
}

export function useLocalPackagings(activeOnly = false) {
  const [packagings, setPackagings] = useState<LocalPackaging[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  const fetchPackagings = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const url = activeOnly
        ? '/api/verpakking/packagings?active=true'
        : '/api/verpakking/packagings'
      const response = await fetch(url, { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch packagings')
      }
      const data = await response.json()
      const rawPackagings: ApiLocalPackaging[] = data.packagings ?? []
      setPackagings(rawPackagings.map(transformPackaging))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    const abortController = new AbortController()
    fetchPackagings(abortController.signal)
    return () => abortController.abort()
  }, [fetchPackagings])

  const syncFromPicqer = useCallback(async () => {
    setIsSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/sync/packagings', { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to sync packagings')
      }
      const result = await response.json()
      await fetchPackagings()
      return result as { synced: number; added: number; updated: number }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [fetchPackagings])

  const createPackaging = useCallback(async (data: {
    name: string
    barcode?: string
    length?: number
    width?: number
    height?: number
  }) => {
    setError(null)

    try {
      const response = await fetch('/api/verpakking/packagings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to create packaging')
      }
      const result = await response.json()
      await fetchPackagings()
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    }
  }, [fetchPackagings])

  const updatePackaging = useCallback(async (idpackaging: number, data: {
    name?: string
    barcode?: string
    length?: number
    width?: number
    height?: number
    max_weight?: number | null
    box_category?: string | null
    specificity_score?: number
    handling_cost?: number
    material_cost?: number
    use_in_auto_advice?: boolean
  }) => {
    setError(null)

    try {
      const response = await fetch('/api/verpakking/packagings/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idpackaging, ...data }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update packaging')
      }
      const result = await response.json()
      await fetchPackagings()
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    }
  }, [fetchPackagings])

  const refresh = useCallback(() => fetchPackagings(), [fetchPackagings])

  return {
    packagings,
    isLoading,
    error,
    isSyncing,
    syncFromPicqer,
    createPackaging,
    updatePackaging,
    refresh,
  }
}
