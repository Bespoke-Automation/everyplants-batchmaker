'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronDown, Pencil, X } from 'lucide-react'
import Dialog from './Dialog'

interface ShippingMethod {
  idshippingprovider_profile: number
  name: string
  carrier?: string
}

interface Packaging {
  idpackaging: number
  name: string
}

interface ShippingProfileEntry {
  count: number
}

interface SelectedGroupInfo {
  fingerprint: string
  displayName: string
  totalCount: number
}

interface CreateShipmentsDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (
    shippingProviderId: number | null,
    packagingOverrides: Record<string, number | null>,
    name?: string,
    shippingOverrides?: Map<number | null, number>
  ) => Promise<void>
  totalOrders: number
  totalGroups: number
  shippingProfileBreakdown: Map<number | null, ShippingProfileEntry>
  firstPicklistId: number | null
  isLoading: boolean
  selectedGroups: SelectedGroupInfo[]
}

export default function CreateShipmentsDialog({
  open,
  onClose,
  onConfirm,
  totalOrders,
  totalGroups,
  shippingProfileBreakdown,
  firstPicklistId,
  isLoading,
  selectedGroups,
}: CreateShipmentsDialogProps) {
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [packagings, setPackagings] = useState<Packaging[]>([])
  const [selectedShippingId, setSelectedShippingId] = useState<number | null>(null)
  // Per-group packaging: fingerprint → packagingId (null = geen)
  const [groupPackagings, setGroupPackagings] = useState<Record<string, number | null>>({})
  const [batchName, setBatchName] = useState('')
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isOverriding, setIsOverriding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-profile overrides: maps original profile ID to new profile ID
  const [profileOverrides, setProfileOverrides] = useState<Map<number | null, number>>(new Map())
  // Which profile row is currently being edited
  const [editingProfileId, setEditingProfileId] = useState<number | null | undefined>(undefined)

  // Fetch data when dialog opens
  useEffect(() => {
    if (open) {
      fetchData()
      // Initialize per-group packaging state
      const initial: Record<string, number | null> = {}
      for (const group of selectedGroups) {
        initial[group.fingerprint] = null
      }
      setGroupPackagings(initial)
    } else {
      setIsOverriding(false)
      setError(null)
      setBatchName('')
      setSelectedShippingId(null)
      setGroupPackagings({})
      setProfileOverrides(new Map())
      setEditingProfileId(undefined)
    }
  }, [open, firstPicklistId])

  const fetchData = async () => {
    setIsLoadingData(true)
    setError(null)

    try {
      const [packagingsRes, methodsRes] = await Promise.all([
        fetch('/api/picqer/packagings'),
        firstPicklistId ? fetch(`/api/picqer/shipping-methods?picklistId=${firstPicklistId}`) : Promise.resolve(null),
      ])

      if (packagingsRes.ok) {
        const data = await packagingsRes.json()
        setPackagings(data.packagings || [])
      }

      if (methodsRes?.ok) {
        const data = await methodsRes.json()
        setShippingMethods(data.methods || [])
      }
    } catch (err) {
      console.error('Error fetching data:', err)
      setError('Kon gegevens niet laden. Probeer opnieuw.')
    } finally {
      setIsLoadingData(false)
    }
  }

  // Format shipping method display name
  const formatMethodName = (method: ShippingMethod) => {
    if (method.carrier) {
      return `${method.carrier} - ${method.name}`
    }
    return method.name
  }

  const getProfileDisplayName = (id: number | null) => {
    if (id == null) return 'Geen profiel'
    const method = shippingMethods.find(m => m.idshippingprovider_profile === id)
    return method ? formatMethodName(method) : `Profiel #${id}`
  }

  // Build display list of profiles in the breakdown
  const breakdownDisplay = useMemo(() => {
    const entries: Array<{ id: number | null; name: string; count: number; overrideName?: string }> = []
    for (const [id, { count }] of shippingProfileBreakdown) {
      const name = getProfileDisplayName(id)
      const overrideId = profileOverrides.get(id)
      const overrideName = overrideId != null ? getProfileDisplayName(overrideId) : undefined
      entries.push({ id, name, count, overrideName })
    }
    return entries
  }, [shippingProfileBreakdown, shippingMethods, profileOverrides])

  const hasOverrides = profileOverrides.size > 0

  const handleSetProfileOverride = (originalId: number | null, newId: number) => {
    setProfileOverrides(prev => {
      const next = new Map(prev)
      // If setting back to original, remove the override
      if (originalId === newId) {
        next.delete(originalId)
      } else {
        next.set(originalId, newId)
      }
      return next
    })
    setEditingProfileId(undefined)
  }

  const handleRemoveOverride = (originalId: number | null) => {
    setProfileOverrides(prev => {
      const next = new Map(prev)
      next.delete(originalId)
      return next
    })
  }

  const handleGroupPackagingChange = (fingerprint: string, packagingId: number | null) => {
    setGroupPackagings(prev => ({ ...prev, [fingerprint]: packagingId }))
  }

  const handleConfirm = async () => {
    if (isOverriding && !selectedShippingId) {
      setError('Selecteer een verzendprofiel')
      return
    }
    const shippingId = isOverriding ? selectedShippingId : null
    // Pass per-profile overrides if any exist and not doing full override
    const overrides = !isOverriding && hasOverrides ? profileOverrides : undefined
    await onConfirm(shippingId, groupPackagings, batchName.trim() || undefined, overrides)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Zending maken">
      <div className="p-4 space-y-6">
        {/* Error message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Loading state */}
        {isLoadingData ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Shipping Profile Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Verzendprofiel
              </label>

              {!isOverriding ? (
                <div className="space-y-2">
                  {/* Breakdown list with per-row editing */}
                  <div className="border border-border rounded-md divide-y divide-border">
                    {breakdownDisplay.map((entry) => {
                      const isEditing = editingProfileId === entry.id
                      const hasOverride = profileOverrides.has(entry.id)

                      return (
                        <div key={entry.id ?? 'null'} className="px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {hasOverride ? (
                                <span className="flex items-center gap-1 min-w-0">
                                  <span className="text-muted-foreground line-through truncate">{entry.name}</span>
                                  <span className="text-muted-foreground">→</span>
                                  <span className="font-medium text-primary truncate">{entry.overrideName}</span>
                                </span>
                              ) : (
                                <span className="font-medium truncate">{entry.name}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-2 shrink-0">
                              <span className="text-muted-foreground">
                                {entry.count} {entry.count === 1 ? 'order' : 'orders'}
                              </span>
                              {hasOverride ? (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOverride(entry.id)}
                                  className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                                  title="Overschrijving ongedaan maken"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingProfileId(isEditing ? undefined : entry.id)}
                                  className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
                                  title="Verzendprofiel wijzigen"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Inline dropdown when editing */}
                          {isEditing && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="relative flex-1">
                                <select
                                  autoFocus
                                  defaultValue=""
                                  onChange={(e) => {
                                    if (e.target.value) {
                                      handleSetProfileOverride(entry.id, Number(e.target.value))
                                    }
                                  }}
                                  className="w-full px-3 py-1.5 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-8"
                                >
                                  <option value="" disabled>Kies verzendprofiel...</option>
                                  {shippingMethods.map((method) => (
                                    <option key={method.idshippingprovider_profile} value={method.idshippingprovider_profile}>
                                      {formatMethodName(method)}
                                    </option>
                                  ))}
                                </select>
                                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                              </div>
                              <button
                                type="button"
                                onClick={() => setEditingProfileId(undefined)}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                Annuleer
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hasOverrides
                      ? 'Gewijzigde profielen worden overschreven, overige orders behouden hun eigen profiel.'
                      : 'Elke order behoudt het eigen verzendprofiel uit Picqer.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOverriding(true)
                      setProfileOverrides(new Map())
                      setEditingProfileId(undefined)
                      if (shippingMethods.length > 0 && !selectedShippingId) {
                        setSelectedShippingId(shippingMethods[0].idshippingprovider_profile)
                      }
                    }}
                    className="text-primary text-sm hover:underline"
                  >
                    Overschrijf alle met één profiel
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <select
                      value={selectedShippingId || ''}
                      onChange={(e) => setSelectedShippingId(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-8"
                    >
                      {shippingMethods.map((method) => (
                        <option key={method.idshippingprovider_profile} value={method.idshippingprovider_profile}>
                          {formatMethodName(method)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Alle {totalOrders} orders krijgen dit verzendprofiel.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsOverriding(false)}
                    className="text-primary text-sm hover:underline"
                  >
                    Annuleer overschrijving
                  </button>
                </div>
              )}
            </div>

            {/* Per-group Packaging Section */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                Verpakking per productgroep
              </label>
              <div className="border border-border rounded-md divide-y divide-border">
                {selectedGroups.map((group) => (
                  <div key={group.fingerprint} className="px-3 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{group.displayName}</span>
                      <span className="text-xs text-muted-foreground">{group.totalCount} orders</span>
                    </div>
                    <div className="relative shrink-0 w-48">
                      <select
                        value={groupPackagings[group.fingerprint] ?? ''}
                        onChange={(e) => handleGroupPackagingChange(
                          group.fingerprint,
                          e.target.value ? Number(e.target.value) : null
                        )}
                        className="w-full px-3 py-1.5 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-8"
                      >
                        <option value="">Geen</option>
                        {packagings.map((packaging) => (
                          <option key={packaging.idpackaging} value={packaging.idpackaging}>
                            {packaging.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Batch Name Section (Optional) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground w-32">
                  Naam
                </label>
                <div className="flex-1">
                  <input
                    type="text"
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="Optioneel - interne naam voor deze batch"
                    className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
            </div>

            {/* Summary */}
            <p className="text-sm text-muted-foreground">
              {totalOrders} orders uit {totalGroups} productgroep(en) worden verwerkt.
            </p>
          </>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            onClick={handleConfirm}
            disabled={isLoading || isLoadingData || (isOverriding && !selectedShippingId)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Shipments aanmaken
          </button>
        </div>
      </div>
    </Dialog>
  )
}
