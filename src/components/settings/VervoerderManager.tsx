'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Loader2, ChevronDown, ChevronUp, Truck } from 'lucide-react'
import { useVervoerders } from '@/hooks/useVervoerders'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface PicqerShippingProfile {
  idshippingprovider_profile: number
  name: string
  carrier: string
}

export default function VervoerderManager() {
  const {
    vervoerders,
    isLoading,
    addVervoerder,
    removeVervoerder,
    addProfiles,
    removeProfile,
  } = useVervoerders()

  const [newName, setNewName] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Picqer shipping profiles
  const [picqerProfiles, setPicqerProfiles] = useState<PicqerShippingProfile[]>([])
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false)

  // Per-vervoerder state
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [addingProfileTo, setAddingProfileTo] = useState<string | null>(null)
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<number>>(new Set())
  const [deletingVervoerder, setDeletingVervoerder] = useState<{ id: string; name: string } | null>(null)

  // Fetch Picqer shipping profiles once
  useEffect(() => {
    async function fetchProfiles() {
      setIsLoadingProfiles(true)
      try {
        const response = await fetch('/api/picqer/shipping-providers')
        if (response.ok) {
          const data = await response.json()
          setPicqerProfiles(data.profiles || [])
        }
      } catch (err) {
        console.error('Failed to fetch shipping profiles:', err)
      } finally {
        setIsLoadingProfiles(false)
      }
    }
    fetchProfiles()
  }, [])

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAddVervoerder = async () => {
    if (!newName.trim()) return
    setIsSubmitting(true)
    setError(null)
    try {
      await addVervoerder(newName.trim())
      setNewName('')
      setIsAdding(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij toevoegen')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteVervoerder = async () => {
    if (!deletingVervoerder) return
    setIsSubmitting(true)
    try {
      await removeVervoerder(deletingVervoerder.id)
      setDeletingVervoerder(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij verwijderen')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleAddProfiles = async (vervoerderId: string) => {
    if (selectedProfileIds.size === 0) return

    const profilesToAdd = picqerProfiles
      .filter(p => selectedProfileIds.has(p.idshippingprovider_profile))
      .map(p => ({
        shipping_profile_id: p.idshippingprovider_profile,
        profile_name: p.name,
        carrier: p.carrier,
      }))

    setIsSubmitting(true)
    setError(null)
    try {
      await addProfiles(vervoerderId, profilesToAdd)
      setAddingProfileTo(null)
      setSelectedProfileIds(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij toevoegen profielen')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemoveProfile = async (vervoerderId: string, profileId: string) => {
    try {
      await removeProfile(vervoerderId, profileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij verwijderen profiel')
    }
  }

  const toggleProfileSelection = (id: number) => {
    setSelectedProfileIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Profiles already assigned to any vervoerder
  const assignedProfileIds = new Set(
    vervoerders.flatMap(v => v.profiles.map(p => p.shipping_profile_id))
  )

  // Available profiles (not yet assigned anywhere)
  const getAvailableProfiles = () => {
    return picqerProfiles.filter(p => !assignedProfileIds.has(p.idshippingprovider_profile))
  }

  const openProfilePicker = (vervoerderId: string) => {
    setAddingProfileTo(vervoerderId)
    setSelectedProfileIds(new Set())
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Vervoerders</h2>
          <p className="text-sm text-muted-foreground">
            Beheer vervoerders en hun verzendprofielen voor het filteren van orders.
          </p>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nieuwe vervoerder
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:opacity-70">&times;</button>
        </div>
      )}

      {isAdding && (
        <div className="p-4 bg-card border border-border rounded-lg space-y-3">
          <label className="text-xs font-bold text-muted-foreground uppercase block">
            Naam
          </label>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="bijv. DPD, PostNL"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleAddVervoerder()}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setIsAdding(false); setNewName('') }}
              className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
              disabled={isSubmitting}
            >
              Annuleren
            </button>
            <button
              onClick={handleAddVervoerder}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
              disabled={isSubmitting || !newName.trim()}
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Toevoegen
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {vervoerders.map(vervoerder => {
          const available = getAvailableProfiles()
          const isPickerOpen = addingProfileTo === vervoerder.id

          return (
            <div key={vervoerder.id} className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleExpanded(vervoerder.id)}
                    className="p-1 hover:bg-muted rounded"
                  >
                    {expandedIds.has(vervoerder.id) ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <h3 className="font-semibold">{vervoerder.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {vervoerder.profiles.length} verzendprofiel{vervoerder.profiles.length !== 1 ? 'en' : ''}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setDeletingVervoerder({ id: vervoerder.id, name: vervoerder.name })}
                  className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
                  title="Verwijderen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {expandedIds.has(vervoerder.id) && (
                <div className="px-4 pb-4 pt-0 space-y-3">
                  {/* Assigned profiles */}
                  {vervoerder.profiles.length > 0 && (
                    <div className="bg-muted/50 rounded-md p-3 space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase">Verzendprofielen</p>
                      {vervoerder.profiles.map(profile => (
                        <div key={profile.id} className="flex items-center justify-between text-sm">
                          <div>
                            <span className="font-medium">{profile.profile_name}</span>
                            {profile.carrier && (
                              <span className="text-muted-foreground ml-2">({profile.carrier})</span>
                            )}
                            <span className="text-xs text-muted-foreground ml-2">
                              ID: {profile.shipping_profile_id}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveProfile(vervoerder.id, profile.id)}
                            className="p-1 hover:bg-destructive/10 text-destructive rounded"
                            title="Verwijderen"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add profiles - multi-select picker */}
                  {isPickerOpen ? (
                    <div className="border border-border rounded-md p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-muted-foreground uppercase">
                          Verzendprofielen toevoegen
                        </p>
                        {available.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (selectedProfileIds.size === available.length) {
                                setSelectedProfileIds(new Set())
                              } else {
                                setSelectedProfileIds(new Set(available.map(p => p.idshippingprovider_profile)))
                              }
                            }}
                            className="text-xs text-primary hover:underline"
                          >
                            {selectedProfileIds.size === available.length ? 'Deselecteer alles' : 'Selecteer alles'}
                          </button>
                        )}
                      </div>

                      {isLoadingProfiles ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Profielen laden...
                        </div>
                      ) : available.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">
                          Alle beschikbare profielen zijn al toegewezen.
                        </p>
                      ) : (
                        <div className="max-h-60 overflow-y-auto space-y-1">
                          {available.map(profile => (
                            <label
                              key={profile.idshippingprovider_profile}
                              className="flex items-center gap-3 px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50 rounded transition-colors"
                            >
                              <input
                                type="checkbox"
                                checked={selectedProfileIds.has(profile.idshippingprovider_profile)}
                                onChange={() => toggleProfileSelection(profile.idshippingprovider_profile)}
                                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                              />
                              <span className="font-medium">{profile.name}</span>
                              <span className="text-muted-foreground">({profile.carrier})</span>
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2 justify-end pt-1">
                        <button
                          onClick={() => { setAddingProfileTo(null); setSelectedProfileIds(new Set()) }}
                          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
                        >
                          Annuleren
                        </button>
                        <button
                          onClick={() => handleAddProfiles(vervoerder.id)}
                          disabled={selectedProfileIds.size === 0 || isSubmitting}
                          className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {isSubmitting && <Loader2 className="w-3 h-3 animate-spin" />}
                          {selectedProfileIds.size > 0
                            ? `${selectedProfileIds.size} profiel${selectedProfileIds.size !== 1 ? 'en' : ''} toevoegen`
                            : 'Toevoegen'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openProfilePicker(vervoerder.id)}
                      className="text-sm text-primary hover:underline flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" />
                      Profielen toevoegen
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {vervoerders.length === 0 && !isAdding && (
        <div className="text-center py-10 text-muted-foreground">
          Geen vervoerders gevonden. Voeg een nieuwe vervoerder toe.
        </div>
      )}

      <ConfirmDialog
        open={!!deletingVervoerder}
        onClose={() => setDeletingVervoerder(null)}
        onConfirm={handleDeleteVervoerder}
        title="Vervoerder verwijderen"
        message={`Weet je zeker dat je "${deletingVervoerder?.name}" en alle gekoppelde verzendprofielen wilt verwijderen?`}
        confirmText="Verwijderen"
        cancelText="Annuleren"
        variant="destructive"
        isLoading={isSubmitting}
      />
    </div>
  )
}
