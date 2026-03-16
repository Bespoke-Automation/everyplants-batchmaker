'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import type { RaapCategory, RaapCategoryLocation } from '@/lib/supabase/raapCategoryLocations'

interface PicqerLocation {
  idlocation: number
  name: string
}

const CATEGORIES: { value: RaapCategory; label: string }[] = [
  { value: 'buitenplanten', label: 'Buitenplanten' },
  { value: 'kamerplanten', label: 'Kamerplanten' },
  { value: 'kunstplanten', label: 'Kunstplanten' },
  { value: 'potten', label: 'Potten' },
]

export default function RaapInstellingenClient() {
  const [picqerLocations, setPicqerLocations] = useState<PicqerLocation[]>([])
  const [assignments, setAssignments] = useState<Record<number, RaapCategory | ''>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [locRes, assignRes] = await Promise.all([
        fetch('/api/picqer/locations'),
        fetch('/api/raapmodule/settings/locations'),
      ])
      const { locations: picqer } = await locRes.json()
      const { locations: saved } = await assignRes.json()

      setPicqerLocations(picqer || [])

      const map: Record<number, RaapCategory | ''> = {}
      for (const loc of (picqer || [])) {
        map[loc.idlocation] = ''
      }
      for (const s of (saved as RaapCategoryLocation[])) {
        map[s.picqer_location_id] = s.category
      }
      setAssignments(map)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage(null)
    try {
      const locations = picqerLocations
        .filter(loc => assignments[loc.idlocation])
        .map(loc => ({
          picqer_location_id: loc.idlocation,
          picqer_location_name: loc.name,
          category: assignments[loc.idlocation] as RaapCategory,
        }))

      const res = await fetch('/api/raapmodule/settings/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations }),
      })

      if (res.ok) {
        setSaveMessage('Opgeslagen')
        setTimeout(() => setSaveMessage(null), 3000)
      } else {
        setSaveMessage('Fout bij opslaan')
      }
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h2 className="text-xl font-bold">Raapmodule Instellingen</h2>
            <p className="text-sm text-muted-foreground">Koppel Picqer locaties aan categorieën</p>
          </div>
        </div>

        <div className="border border-border rounded-lg overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Locatie</th>
                <th className="text-left px-4 py-3 font-medium w-48">Categorie</th>
              </tr>
            </thead>
            <tbody>
              {picqerLocations.map((loc) => (
                <tr key={loc.idlocation} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{loc.name}</td>
                  <td className="px-4 py-2">
                    <select
                      value={assignments[loc.idlocation] || ''}
                      onChange={(e) =>
                        setAssignments(prev => ({
                          ...prev,
                          [loc.idlocation]: e.target.value as RaapCategory | '',
                        }))
                      }
                      className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      <option value="">— geen —</option>
                      {CATEGORIES.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Opslaan
          </button>
          {saveMessage && (
            <span className="text-sm text-muted-foreground">{saveMessage}</span>
          )}
        </div>
      </div>
    </div>
  )
}
