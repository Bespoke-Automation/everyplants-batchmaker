'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Preset } from '@/types/preset'
import { getPresets, createPreset, deletePreset, type PresetType } from '@/lib/supabase/presets'

interface UsePresetsReturn {
  presets: Preset[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
  addPreset: (preset: Omit<Preset, 'id'>) => Promise<Preset>
  removePreset: (id: string) => Promise<void>
}

export function usePresets(type: PresetType): UsePresetsReturn {
  const [presets, setPresets] = useState<Preset[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchPresets = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await getPresets(type)
      setPresets(data)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch presets'))
    } finally {
      setIsLoading(false)
    }
  }, [type])

  useEffect(() => {
    fetchPresets()
  }, [fetchPresets])

  const addPreset = useCallback(async (preset: Omit<Preset, 'id'>): Promise<Preset> => {
    const newPreset = await createPreset(type, preset)
    setPresets((prev) => [...prev, newPreset])
    return newPreset
  }, [type])

  const removePreset = useCallback(async (id: string): Promise<void> => {
    await deletePreset(type, id)
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }, [type])

  return {
    presets,
    isLoading,
    error,
    refresh: fetchPresets,
    addPreset,
    removePreset,
  }
}
