'use client'

import { useState, useEffect, useCallback } from 'react'

interface TablePreferences {
  columnOrder: string[]
  setColumnOrder: (order: string[]) => void
  columnSizing: Record<string, number>
  setColumnSizing: (sizing: Record<string, number>) => void
  resetPreferences: () => void
}

export function useTablePreferences(tableKey: string): TablePreferences {
  const orderKey = `${tableKey}_column_order`
  const sizingKey = `${tableKey}_column_sizing`

  const [columnOrder, setColumnOrderState] = useState<string[]>([])
  const [columnSizing, setColumnSizingState] = useState<Record<string, number>>({})

  // Restore from localStorage on mount
  useEffect(() => {
    try {
      const storedOrder = localStorage.getItem(orderKey)
      if (storedOrder) setColumnOrderState(JSON.parse(storedOrder))
    } catch {
      // Ignore parse errors
    }
    try {
      const storedSizing = localStorage.getItem(sizingKey)
      if (storedSizing) setColumnSizingState(JSON.parse(storedSizing))
    } catch {
      // Ignore parse errors
    }
  }, [orderKey, sizingKey])

  const setColumnOrder = useCallback((order: string[]) => {
    setColumnOrderState(order)
    try {
      localStorage.setItem(orderKey, JSON.stringify(order))
    } catch {
      // Ignore storage errors
    }
  }, [orderKey])

  const setColumnSizing = useCallback((sizing: Record<string, number>) => {
    setColumnSizingState(sizing)
    try {
      localStorage.setItem(sizingKey, JSON.stringify(sizing))
    } catch {
      // Ignore storage errors
    }
  }, [sizingKey])

  const resetPreferences = useCallback(() => {
    setColumnOrderState([])
    setColumnSizingState({})
    try {
      localStorage.removeItem(orderKey)
      localStorage.removeItem(sizingKey)
    } catch {
      // Ignore storage errors
    }
  }, [orderKey, sizingKey])

  return {
    columnOrder,
    setColumnOrder,
    columnSizing,
    setColumnSizing,
    resetPreferences,
  }
}
