'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'

export type PrinterStatus = 'online' | 'offline' | 'disconnected' | 'unknown'

export interface PackingStation {
  id: string
  name: string
  printnode_printer_id: number
  printnode_printer_name: string | null
  printer_status?: PrinterStatus
  computer_name?: string | null
}

const STORAGE_KEY = 'verpakking_packing_station'

export function usePackingStation() {
  const { data, isLoading } = useSWR<{ stations: PackingStation[] }>(
    '/api/verpakking/packing-stations',
    { revalidateOnFocus: false }
  )

  const stations = data?.stations ?? []

  const [selectedStation, setSelectedStation] = useState<PackingStation | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : null
    } catch {
      return null
    }
  })

  // Sync selectedStation with fetched stations (validate it still exists)
  useEffect(() => {
    if (!selectedStation || stations.length === 0) return
    const stillExists = stations.find(s => s.id === selectedStation.id)
    if (!stillExists) {
      setSelectedStation(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [stations, selectedStation])

  const selectStation = useCallback((station: PackingStation) => {
    setSelectedStation(station)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(station))
    } catch {
      // Ignore storage errors
    }
  }, [])

  const clearStation = useCallback(() => {
    setSelectedStation(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore storage errors
    }
  }, [])

  return {
    stations,
    selectedStation,
    isLoading,
    selectStation,
    clearStation,
    packingStationId: selectedStation?.id ?? undefined,
  }
}
