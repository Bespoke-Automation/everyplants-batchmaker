'use client'

import { useState, useCallback } from 'react'
import useSWR from 'swr'
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
  image_url: string | null
  use_in_auto_advice: boolean
  active: boolean
  last_synced_at: string
  picqer_tag_name: string | null
  num_shipping_labels: number
  facturatie_box_sku: string | null
  strapped_variant_id: string | null
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
    imageUrl: raw.image_url,
    useInAutoAdvice: raw.use_in_auto_advice,
    active: raw.active,
    lastSyncedAt: raw.last_synced_at,
    picqerTagName: raw.picqer_tag_name,
    numShippingLabels: raw.num_shipping_labels ?? 1,
    facturatieBoxSku: raw.facturatie_box_sku,
    strappedVariantId: raw.strapped_variant_id,
  }
}

export function useLocalPackagings(activeOnly = false) {
  const url = activeOnly
    ? '/api/verpakking/packagings?active=true'
    : '/api/verpakking/packagings'

  const { data, error, isLoading, mutate } = useSWR<{ packagings: ApiLocalPackaging[] }>(
    url,
    { revalidateOnFocus: false }
  )

  const packagings = (data?.packagings ?? []).map(transformPackaging)

  const [isSyncing, setIsSyncing] = useState(false)

  const syncFromPicqer = useCallback(async () => {
    setIsSyncing(true)
    try {
      const response = await fetch('/api/verpakking/sync/packagings', { method: 'POST' })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to sync packagings')
      }
      const result = await response.json()
      await mutate()
      return result as { synced: number; added: number; updated: number }
    } catch (err) {
      throw err instanceof Error ? err : new Error('Unknown error')
    } finally {
      setIsSyncing(false)
    }
  }, [mutate])

  const createPackaging = useCallback(async (createData: {
    name: string
    barcode?: string
    length?: number
    width?: number
    height?: number
    skipPicqer?: boolean
    idpackaging?: number
  }) => {
    const response = await fetch('/api/verpakking/packagings/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createData),
    })
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to create packaging')
    }
    const result = await response.json()
    await mutate()
    return result
  }, [mutate])

  const updatePackaging = useCallback(async (idpackaging: number, updateData: {
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
    new_idpackaging?: number
    picqer_tag_name?: string | null
    num_shipping_labels?: number
    facturatie_box_sku?: string | null
    strapped_variant_id?: string | null
  }) => {
    const response = await fetch('/api/verpakking/packagings/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idpackaging, ...updateData }),
    })
    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to update packaging')
    }
    const result = await response.json()
    await mutate()
    return result
  }, [mutate])

  const deletePackaging = useCallback(async (idpackaging: number, transferToIdpackaging?: number) => {
    const response = await fetch('/api/verpakking/packagings/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idpackaging, transferToIdpackaging }),
    })
    const result = await response.json()
    if (!response.ok) {
      if (response.status === 409 && result.error === 'has_rules') {
        return result as { error: 'has_rules'; ruleCount: number; message: string }
      }
      throw new Error(result.error || 'Failed to delete packaging')
    }
    await mutate()
    return result as { success: boolean; rulesTransferred?: number; warnings?: string[] }
  }, [mutate])

  const refresh = useCallback(() => mutate(), [mutate])

  return {
    packagings,
    isLoading,
    error: error ?? null,
    isSyncing,
    syncFromPicqer,
    createPackaging,
    updatePackaging,
    deletePackaging,
    refresh,
  }
}
