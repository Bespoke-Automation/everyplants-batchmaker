'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompartmentRule {
  id: string
  packagingId: string
  ruleGroup: number
  shippingUnitId: string
  shippingUnitName: string
  quantity: number
  operator: string // 'EN', 'OF', 'ALTERNATIEF'
  alternativeForId: string | null
  sortOrder: number
  isActive: boolean
  packagingName: string
}

export interface ShippingUnit {
  id: string
  name: string
  productType: string
  sortOrder: number
}

interface ApiCompartmentRule {
  id: string
  packaging_id: string
  rule_group: number
  shipping_unit_id: string
  quantity: number
  operator: string
  alternative_for_id: string | null
  sort_order: number
  is_active: boolean
  shipping_unit_name?: string
  packaging_name?: string
}

interface ApiShippingUnit {
  id: string
  name: string
  product_type: string
  sort_order: number
}

// ── Transformers ─────────────────────────────────────────────────────────────

function transformRule(raw: ApiCompartmentRule): CompartmentRule {
  return {
    id: raw.id,
    packagingId: raw.packaging_id,
    ruleGroup: raw.rule_group,
    shippingUnitId: raw.shipping_unit_id,
    shippingUnitName: raw.shipping_unit_name ?? '',
    quantity: raw.quantity,
    operator: raw.operator,
    alternativeForId: raw.alternative_for_id,
    sortOrder: raw.sort_order,
    isActive: raw.is_active,
    packagingName: raw.packaging_name ?? '',
  }
}

function transformShippingUnit(raw: ApiShippingUnit): ShippingUnit {
  return {
    id: raw.id,
    name: raw.name,
    productType: raw.product_type,
    sortOrder: raw.sort_order,
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCompartmentRules(packagingId?: string) {
  const [rules, setRules] = useState<CompartmentRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchRules = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const url = packagingId
        ? `/api/verpakking/compartment-rules?packaging_id=${packagingId}`
        : '/api/verpakking/compartment-rules'
      const response = await fetch(url, { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch compartment rules')
      }
      const data = await response.json()
      const rawRules: ApiCompartmentRule[] = data.rules ?? []
      setRules(rawRules.map(transformRule))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [packagingId])

  useEffect(() => {
    const abortController = new AbortController()
    fetchRules(abortController.signal)
    return () => abortController.abort()
  }, [fetchRules])

  const addRule = useCallback(
    async (rule: {
      packagingId: string
      ruleGroup: number
      shippingUnitId: string
      quantity?: number
      operator?: string
      alternativeForId?: string | null
      sortOrder?: number
    }) => {
      setError(null)
      try {
        const response = await fetch('/api/verpakking/compartment-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to create rule')
        }
        const data = await response.json()
        const newRule = transformRule(data.rule)
        setRules((prev) => [...prev, newRule])
        return newRule
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      }
    },
    []
  )

  const updateRule = useCallback(
    async (id: string, updates: Partial<{
      quantity: number
      operator: string
      isActive: boolean
      sortOrder: number
      shippingUnitId: string
      alternativeForId: string | null
    }>) => {
      setError(null)
      try {
        const response = await fetch('/api/verpakking/compartment-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, ...updates }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update rule')
        }
        const data = await response.json()
        const updatedRule = transformRule(data.rule)
        setRules((prev) =>
          prev.map((r) => (r.id === id ? updatedRule : r))
        )
        return updatedRule
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error')
        setError(error)
        throw error
      }
    },
    []
  )

  const removeRule = useCallback(async (id: string) => {
    setError(null)
    const removedItem = rules.find((r) => r.id === id)
    setRules((prev) => prev.filter((r) => r.id !== id))

    try {
      const response = await fetch('/api/verpakking/compartment-rules', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete rule')
      }
    } catch (err) {
      if (removedItem) {
        setRules((prev) => [...prev, removedItem])
      }
      const error = err instanceof Error ? err : new Error('Unknown error')
      setError(error)
      throw error
    }
  }, [rules])

  const refresh = useCallback(() => fetchRules(), [fetchRules])

  return {
    rules,
    isLoading,
    error,
    addRule,
    updateRule,
    removeRule,
    refresh,
  }
}

// ── Shipping Units Hook ──────────────────────────────────────────────────────

export function useShippingUnits() {
  const [shippingUnits, setShippingUnits] = useState<ShippingUnit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const fetchShippingUnits = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/verpakking/shipping-units', { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch shipping units')
      }
      const data = await response.json()
      const rawUnits: ApiShippingUnit[] = data.shippingUnits ?? []
      setShippingUnits(rawUnits.map(transformShippingUnit))
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const abortController = new AbortController()
    fetchShippingUnits(abortController.signal)
    return () => abortController.abort()
  }, [fetchShippingUnits])

  return {
    shippingUnits,
    isLoading,
    error,
  }
}
