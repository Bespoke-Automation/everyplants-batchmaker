'use client'

import { useState, useEffect, useCallback } from 'react'
import type { LocalTag } from '@/types/verpakking'

interface ApiLocalTag {
  id: string
  idtag: number
  title: string
  color: string | null
  text_color: string | null
  inherit: boolean
  tag_type: 'packaging' | 'plantura' | 'other'
  is_active: boolean
  last_synced_at: string
}

function transformTag(raw: ApiLocalTag): LocalTag {
  return {
    id: raw.id,
    idtag: raw.idtag,
    title: raw.title,
    color: raw.color,
    textColor: raw.text_color,
    inherit: raw.inherit,
    tagType: raw.tag_type,
    isActive: raw.is_active,
    lastSyncedAt: raw.last_synced_at,
  }
}

export function useLocalTags(typeFilter?: string) {
  const [tags, setTags] = useState<LocalTag[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  const fetchTags = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const url = typeFilter
        ? `/api/verpakking/tags?type=${typeFilter}`
        : '/api/verpakking/tags'
      const response = await fetch(url, { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch tags')
      }
      const data = await response.json()
      const rawTags: ApiLocalTag[] = data.tags ?? []
      setTags(rawTags.map(transformTag))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [typeFilter])

  useEffect(() => {
    const abortController = new AbortController()
    fetchTags(abortController.signal)
    return () => abortController.abort()
  }, [fetchTags])

  const syncFromPicqer = useCallback(async () => {
    setIsSyncing(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/sync/tags', { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to sync tags')
      }
      const result = await response.json()
      await fetchTags()
      return result as { synced: number; added: number; updated: number }
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    } finally {
      setIsSyncing(false)
    }
  }, [fetchTags])

  const updateTagType = useCallback(async (idtag: number, tagType: 'packaging' | 'plantura' | 'other') => {
    setError(null)

    // Optimistic update
    setTags((prev) =>
      prev.map((t) => (t.idtag === idtag ? { ...t, tagType } : t))
    )

    try {
      const response = await fetch('/api/verpakking/tags', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idtag, tag_type: tagType }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to update tag type')
      }
    } catch (err) {
      // Revert on error
      await fetchTags()
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    }
  }, [fetchTags])

  const refresh = useCallback(() => fetchTags(), [fetchTags])

  return {
    tags,
    isLoading,
    error,
    isSyncing,
    syncFromPicqer,
    updateTagType,
    refresh,
  }
}
