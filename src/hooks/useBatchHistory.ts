'use client'

import { useState, useEffect, useCallback } from 'react'
import { SingleOrderBatch, BatchHistoryResult } from '@/lib/supabase/shipmentLabels'

export function useBatchHistory(initialPage: number = 1, pageSize: number = 20) {
  const [data, setData] = useState<BatchHistoryResult | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [page, setPage] = useState(initialPage)

  const fetchHistory = useCallback(async (pageNum: number, signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/single-orders/history?page=${pageNum}&pageSize=${pageSize}`,
        { signal }
      )

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch batch history')
      }

      const responseData: BatchHistoryResult = await response.json()
      setData(responseData)
      setIsLoading(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setIsLoading(false)
    }
  }, [pageSize])

  useEffect(() => {
    const abortController = new AbortController()
    fetchHistory(page, abortController.signal)
    return () => abortController.abort()
  }, [page, fetchHistory])

  const goToPage = useCallback((newPage: number) => {
    if (newPage >= 1 && (!data || newPage <= data.totalPages)) {
      setPage(newPage)
    }
  }, [data])

  const refetch = useCallback(() => fetchHistory(page), [page, fetchHistory])

  return {
    batches: data?.batches ?? [],
    totalCount: data?.totalCount ?? 0,
    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    totalPages: data?.totalPages ?? 0,
    isLoading,
    error,
    goToPage,
    refetch,
  }
}
