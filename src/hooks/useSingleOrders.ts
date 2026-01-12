'use client'

import { useState, useEffect, useCallback } from 'react'
import { ProductGroup, SingleOrdersResponse } from '@/types/singleOrder'

interface OrdersMetadata {
  retailers: string[]
  tags: string[]
  countries: string[]
  leverdagen: string[]
}

export function useSingleOrders() {
  const [data, setData] = useState<SingleOrdersResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchSingleOrders = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/single-orders', { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch single orders')
      }
      const responseData = await response.json()
      setData(responseData)
      setIsLoading(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    fetchSingleOrders(abortController.signal)
    return () => abortController.abort()
  }, [fetchSingleOrders])

  const refetch = useCallback(() => fetchSingleOrders(), [fetchSingleOrders])

  return {
    groups: data?.groups ?? [],
    totalSingleOrders: data?.totalSingleOrders ?? 0,
    metadata: data?.metadata ?? { retailers: [], tags: [], countries: [], leverdagen: [] },
    fetchedAt: data?.fetchedAt,
    isLoading,
    error,
    refetch,
  }
}
