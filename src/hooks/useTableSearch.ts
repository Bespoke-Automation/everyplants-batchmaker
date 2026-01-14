'use client'

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'

type FieldAccessor<T> = keyof T | ((item: T) => string)

interface UseTableSearchOptions {
  debounceMs?: number
}

export function useTableSearch<T>(
  items: T[],
  searchableFields: FieldAccessor<T>[],
  options: UseTableSearchOptions = {}
) {
  const { debounceMs = 300 } = options
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Debounce the search query
  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery)
    }, debounceMs)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [searchQuery, debounceMs])

  const filteredItems = useMemo(() => {
    if (!debouncedQuery.trim()) return items

    const lowerQuery = debouncedQuery.toLowerCase().trim()

    return items.filter(item => {
      return searchableFields.some(field => {
        let value: string
        if (typeof field === 'function') {
          value = field(item)
        } else {
          const fieldValue = item[field]
          value = fieldValue === null || fieldValue === undefined
            ? ''
            : String(fieldValue)
        }
        return value.toLowerCase().includes(lowerQuery)
      })
    })
  }, [items, debouncedQuery, searchableFields])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setDebouncedQuery('')
  }, [])

  return {
    searchQuery,
    setSearchQuery,
    filteredItems,
    clearSearch,
    isSearching: searchQuery !== debouncedQuery,
  }
}
