'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Vervoerder } from '@/lib/supabase/vervoerders'

export function useVervoerders() {
  const [vervoerders, setVervoerders] = useState<Vervoerder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchVervoerders = useCallback(async () => {
    try {
      const response = await fetch('/api/vervoerders')
      if (!response.ok) throw new Error('Failed to fetch vervoerders')
      const data = await response.json()
      setVervoerders(data.vervoerders)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVervoerders()
  }, [fetchVervoerders])

  const addVervoerder = useCallback(async (name: string) => {
    const response = await fetch('/api/vervoerders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to create vervoerder')
    }
    await fetchVervoerders()
  }, [fetchVervoerders])

  const removeVervoerder = useCallback(async (id: string) => {
    const response = await fetch(`/api/vervoerders/${id}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error('Failed to delete vervoerder')
    await fetchVervoerders()
  }, [fetchVervoerders])

  const addProfile = useCallback(async (
    vervoerderId: string,
    profile: { shipping_profile_id: number; profile_name: string; carrier?: string }
  ) => {
    const response = await fetch(`/api/vervoerders/${vervoerderId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to add profile')
    }
    await fetchVervoerders()
  }, [fetchVervoerders])

  const addProfiles = useCallback(async (
    vervoerderId: string,
    profiles: { shipping_profile_id: number; profile_name: string; carrier?: string }[]
  ) => {
    const response = await fetch(`/api/vervoerders/${vervoerderId}/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles }),
    })
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || 'Failed to add profiles')
    }
    await fetchVervoerders()
  }, [fetchVervoerders])

  const removeProfile = useCallback(async (vervoerderId: string, profileId: string) => {
    const response = await fetch(`/api/vervoerders/${vervoerderId}/profiles/${profileId}`, {
      method: 'DELETE',
    })
    if (!response.ok) throw new Error('Failed to remove profile')
    await fetchVervoerders()
  }, [fetchVervoerders])

  // Build a map of shipping_profile_id -> vervoerder ID for filter logic
  const shippingProfileToVervoerderMap = useCallback((): Map<number, string> => {
    const map = new Map<number, string>()
    for (const v of vervoerders) {
      for (const p of v.profiles) {
        map.set(p.shipping_profile_id, v.id)
      }
    }
    return map
  }, [vervoerders])

  return {
    vervoerders,
    isLoading,
    error,
    addVervoerder,
    removeVervoerder,
    addProfile,
    addProfiles,
    removeProfile,
    shippingProfileToVervoerderMap,
    refetch: fetchVervoerders,
  }
}
