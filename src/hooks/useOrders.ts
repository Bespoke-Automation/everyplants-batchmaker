'use client'

import { useState, useEffect, useCallback } from 'react'
import { TransformedOrder } from '@/types/order'

interface OrdersMetadata {
  retailers: string[]
  tags: string[]
  countries: string[]
  leverdagen: string[]
}

interface OrdersResponse {
  orders: TransformedOrder[]
  metadata: OrdersMetadata
  total: number
  fetchedAt: string
}

export function useOrders() {
  const [data, setData] = useState<OrdersResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchOrders = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/orders', { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch orders')
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
    fetchOrders(abortController.signal)
    return () => abortController.abort()
  }, [fetchOrders])

  const refetch = useCallback(() => fetchOrders(), [fetchOrders])

  return {
    orders: data?.orders ?? [],
    metadata: data?.metadata ?? { retailers: [], tags: [], countries: [], leverdagen: [] },
    total: data?.total ?? 0,
    fetchedAt: data?.fetchedAt,
    isLoading,
    error,
    refetch,
  }
}
