'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  PostalRegion,
  PostalRegionInsert,
  PostalRegionUpdate,
  getPostalRegions,
  getAllPostalRegions,
  createPostalRegion,
  updatePostalRegion,
  deletePostalRegion,
} from '@/lib/supabase/postalRegions'

interface UsePostalRegionsOptions {
  includeInactive?: boolean
}

export function usePostalRegions(options: UsePostalRegionsOptions = {}) {
  const { includeInactive = false } = options
  const [regions, setRegions] = useState<PostalRegion[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchRegions = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const data = includeInactive
        ? await getAllPostalRegions()
        : await getPostalRegions()
      setRegions(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch postal regions'))
    } finally {
      setIsLoading(false)
    }
  }, [includeInactive])

  useEffect(() => {
    fetchRegions()
  }, [fetchRegions])

  const addRegion = useCallback(async (region: PostalRegionInsert): Promise<PostalRegion> => {
    const newRegion = await createPostalRegion(region)
    setRegions(prev => [...prev, newRegion].sort((a, b) => a.sort_order - b.sort_order))
    return newRegion
  }, [])

  const editRegion = useCallback(async (id: string, updates: PostalRegionUpdate): Promise<PostalRegion> => {
    const updatedRegion = await updatePostalRegion(id, updates)
    setRegions(prev =>
      prev
        .map(r => (r.id === id ? updatedRegion : r))
        .sort((a, b) => a.sort_order - b.sort_order)
    )
    return updatedRegion
  }, [])

  const removeRegion = useCallback(async (id: string): Promise<void> => {
    await deletePostalRegion(id)
    setRegions(prev => prev.filter(r => r.id !== id))
  }, [])

  const refetch = useCallback(() => {
    fetchRegions()
  }, [fetchRegions])

  return {
    regions,
    isLoading,
    error,
    addRegion,
    editRegion,
    removeRegion,
    refetch,
  }
}
