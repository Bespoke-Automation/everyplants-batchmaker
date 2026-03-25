'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Save, ArrowLeft, Plus, X, Search } from 'lucide-react'
import Link from 'next/link'
import type { RaapCategory, RaapCategoryLocation } from '@/lib/supabase/raapCategoryLocations'

interface PicqerLocation {
  idlocation: number
  name: string
}

interface ConfiguredLocation {
  idlocation: number
  name: string
  category: RaapCategory | ''
}

const CATEGORIES: { value: RaapCategory; label: string }[] = [
  { value: 'buitenplanten', label: 'Buitenplanten' },
  { value: 'kamerplanten', label: 'Kamerplanten' },
  { value: 'kunstplanten', label: 'Kunstplanten' },
  { value: 'potten', label: 'Potten' },
]

/** Find all sub-locations that belong to a given top-level location */
function findChildren(parent: PicqerLocation, all: PicqerLocation[]): PicqerLocation[] {
  // Children must start with the full parent name (e.g. "1. Pots" → "1. Pots A", "1. Pots.1")
  // This prevents "1.1 WT" from being matched as a child of "1. Pots"
  const prefix = parent.name
  return all.filter(loc =>
    loc.idlocation !== parent.idlocation &&
    (loc.name.startsWith(prefix + ' ') || loc.name.startsWith(prefix + '.'))
  )
}

export default function RaapInstellingenClient() {
  const [allLocations, setAllLocations] = useState<PicqerLocation[]>([])
  const [configured, setConfigured] = useState<ConfiguredLocation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // Search dropdown state
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [locRes, assignRes] = await Promise.all([
        fetch('/api/picqer/locations'),
        fetch('/api/raapmodule/settings/locations'),
      ])
      const { locations: allData } = await locRes.json()
      const { locations: saved } = await assignRes.json()

      const all: PicqerLocation[] = allData || []
      setAllLocations(all)

      // Build configured list from saved top-level entries
      // (saved also contains children auto-expanded from previous saves — dedupe by showing unique categories per parent)
      const savedMap = new Map<number, RaapCategory>(
        (saved as RaapCategoryLocation[]).map(s => [s.picqer_location_id, s.category])
      )

      // Show only saved entries that are in the top-level pool: exact match in allLocations
      // To determine "configured" parents: find all saved entries whose name is not a child of another saved entry
      const savedIds = new Set((saved as RaapCategoryLocation[]).map(s => s.picqer_location_id))
      const savedLocNames = new Map<number, string>(
        (saved as RaapCategoryLocation[]).map(s => [s.picqer_location_id, s.picqer_location_name])
      )

      // A saved entry is a "parent" if no other saved entry has it as a child
      // Simplest: show saved entries that exist in allLocations and are not children of other saved entries
      const parentEntries: ConfiguredLocation[] = []
      for (const loc of all) {
        if (!savedIds.has(loc.idlocation)) continue
        // Check if this location could be a child of another saved location
        const isChild = parentEntries.some(p => {
          const children = findChildren(p, all)
          return children.some(c => c.idlocation === loc.idlocation)
        })
        if (!isChild) {
          parentEntries.push({
            idlocation: loc.idlocation,
            name: loc.name,
            category: savedMap.get(loc.idlocation) ?? '',
          })
        }
      }

      setConfigured(parentEntries)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const configuredIds = new Set(configured.map(c => c.idlocation))
  const filtered = search.trim()
    ? allLocations.filter(loc =>
        !configuredIds.has(loc.idlocation) &&
        loc.name.toLowerCase().includes(search.toLowerCase())
      )
    : []

  const addLocation = (loc: PicqerLocation) => {
    setConfigured(prev => [...prev, { idlocation: loc.idlocation, name: loc.name, category: '' }])
    setSearch('')
    setShowDropdown(false)
  }

  const removeLocation = (id: number) => {
    setConfigured(prev => prev.filter(c => c.idlocation !== id))
  }

  const updateCategory = (id: number, category: RaapCategory | '') => {
    setConfigured(prev => prev.map(c => c.idlocation === id ? { ...c, category } : c))
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage(null)
    try {
      const locationsToSave: { picqer_location_id: number; picqer_location_name: string; category: RaapCategory }[] = []

      for (const loc of configured) {
        if (!loc.category) continue
        locationsToSave.push({
          picqer_location_id: loc.idlocation,
          picqer_location_name: loc.name,
          category: loc.category,
        })
        for (const child of findChildren(loc, allLocations)) {
          locationsToSave.push({
            picqer_location_id: child.idlocation,
            picqer_location_name: child.name,
            category: loc.category,
          })
        }
      }

      const res = await fetch('/api/raapmodule/settings/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locations: locationsToSave }),
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

        {/* Location search / add */}
        <div className="mb-4" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Locatie toevoegen..."
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDropdown(true) }}
              onFocus={() => search && setShowDropdown(true)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {showDropdown && filtered.length > 0 && (
            <div className="absolute z-10 mt-1 w-full max-w-3xl bg-card border border-border rounded-lg shadow-lg overflow-hidden">
              <ul className="max-h-56 overflow-y-auto">
                {filtered.slice(0, 20).map(loc => (
                  <li key={loc.idlocation}>
                    <button
                      onClick={() => addLocation(loc)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      {loc.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Configured locations table */}
        {configured.length > 0 ? (
          <div className="border border-border rounded-lg overflow-hidden mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-muted-foreground">
                  <th className="text-left px-4 py-3 font-medium">Locatie</th>
                  <th className="text-left px-4 py-3 font-medium w-48">Categorie</th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {configured.map(loc => (
                  <tr key={loc.idlocation} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium">{loc.name}</td>
                    <td className="px-4 py-2">
                      <select
                        value={loc.category}
                        onChange={e => updateCategory(loc.idlocation, e.target.value as RaapCategory | '')}
                        className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">— geen —</option>
                        {CATEGORIES.map(cat => (
                          <option key={cat.value} value={cat.value}>{cat.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => removeLocation(loc.idlocation)}
                        className="p-1 hover:bg-muted rounded transition-colors text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="border border-border rounded-lg px-4 py-8 text-center text-sm text-muted-foreground mb-4">
            Nog geen locaties geconfigureerd. Zoek hierboven naar een locatie om te beginnen.
          </div>
        )}

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
