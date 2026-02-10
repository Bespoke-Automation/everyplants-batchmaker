'use client'

import { useState, useEffect, useCallback } from 'react'
import type { TagPackagingMapping } from '@/types/verpakking'

interface ApiTagMapping {
  id: string
  tag_title: string
  picqer_packaging_id: number
  packaging_name: string
  priority: number
  is_active: boolean
}

function transformMapping(raw: ApiTagMapping): TagPackagingMapping {
  return {
    id: raw.id,
    tagTitle: raw.tag_title,
    picqerPackagingId: raw.picqer_packaging_id,
    packagingName: raw.packaging_name,
    priority: raw.priority,
    isActive: raw.is_active,
  }
}

function toSnakeCase(mapping: Partial<TagPackagingMapping>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (mapping.tagTitle !== undefined) result.tag_title = mapping.tagTitle
  if (mapping.picqerPackagingId !== undefined) result.picqer_packaging_id = mapping.picqerPackagingId
  if (mapping.packagingName !== undefined) result.packaging_name = mapping.packagingName
  if (mapping.priority !== undefined) result.priority = mapping.priority
  if (mapping.isActive !== undefined) result.is_active = mapping.isActive
  return result
}

export function useTagMappings() {
  const [mappings, setMappings] = useState<TagPackagingMapping[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchMappings = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/tag-mappings', { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch tag mappings')
      }
      const data = await response.json()
      const rawMappings: ApiTagMapping[] = data.mappings ?? []
      setMappings(rawMappings.map(transformMapping))
      setIsLoading(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    fetchMappings(abortController.signal)
    return () => abortController.abort()
  }, [fetchMappings])

  const addMapping = useCallback(
    async (mapping: Omit<TagPackagingMapping, 'id'>) => {
      setError(null)
      try {
        const response = await fetch('/api/verpakking/tag-mappings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(toSnakeCase(mapping)),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to create tag mapping')
        }
        const data = await response.json()
        const newMapping = transformMapping(data.mapping ?? data)
        setMappings((prev) => [...prev, newMapping])
        return newMapping
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      }
    },
    []
  )

  const updateMapping = useCallback(
    async (id: string, updates: Partial<TagPackagingMapping>) => {
      setError(null)
      try {
        const response = await fetch('/api/verpakking/tag-mappings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...toSnakeCase(updates) }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update tag mapping')
        }
        const data = await response.json()
        const updatedMapping = transformMapping(data.mapping ?? data)
        setMappings((prev) =>
          prev.map((m) => (m.id === id ? updatedMapping : m))
        )
        return updatedMapping
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      }
    },
    []
  )

  const removeMapping = useCallback(async (id: string) => {
    setError(null)

    // Save removed item for rollback
    const removedItem = mappings.find((m) => m.id === id)

    // Optimistically remove
    setMappings((prev) => prev.filter((m) => m.id !== id))

    try {
      const response = await fetch('/api/verpakking/tag-mappings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete tag mapping')
      }
    } catch (err) {
      // Restore the removed item
      if (removedItem) {
        setMappings((prev) => [...prev, removedItem])
      }
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    }
  }, [mappings])

  const refresh = useCallback(() => fetchMappings(), [fetchMappings])

  const getMappingsForTags = useCallback(
    (tags: string[]): TagPackagingMapping[] => {
      if (tags.length === 0) return []
      const tagSet = new Set(tags.map((t) => t.toLowerCase()))
      return mappings
        .filter((m) => m.isActive && tagSet.has(m.tagTitle.toLowerCase()))
        .sort((a, b) => a.priority - b.priority)
    },
    [mappings]
  )

  return {
    mappings,
    isLoading,
    error,
    addMapping,
    updateMapping,
    removeMapping,
    refresh,
    getMappingsForTags,
  }
}
