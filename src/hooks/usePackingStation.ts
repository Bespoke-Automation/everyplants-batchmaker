'use client'

import { useState, useEffect, useCallback } from 'react'

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
  const [stations, setStations] = useState<PackingStation[]>([])
  const [selectedStation, setSelectedStation] = useState<PackingStation | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Restore selected station from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setSelectedStation(JSON.parse(stored))
      }
    } catch {
      // Ignore parse errors
    }
  }, [])

  // Fetch available stations
  useEffect(() => {
    let cancelled = false

    async function fetchStations() {
      try {
        const response = await fetch('/api/verpakking/packing-stations')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) {
          setStations(data.stations ?? [])
        }
      } catch {
        // Silent fail
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchStations()
    return () => { cancelled = true }
  }, [])

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
