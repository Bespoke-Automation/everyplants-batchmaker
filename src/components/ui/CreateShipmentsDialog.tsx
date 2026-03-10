'use client'

import { useState, useEffect, useMemo } from 'react'
import { Loader2, ChevronDown } from 'lucide-react'
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

interface CreateShipmentsDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (shippingProviderId: number | null, packagingId: number | null, name?: string) => Promise<void>
  totalOrders: number
  totalGroups: number
  shippingProfileBreakdown: Map<number | null, ShippingProfileEntry>
  firstPicklistId: number | null
  isLoading: boolean
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
}: CreateShipmentsDialogProps) {
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [packagings, setPackagings] = useState<Packaging[]>([])
  const [selectedShippingId, setSelectedShippingId] = useState<number | null>(null)
  const [selectedPackagingId, setSelectedPackagingId] = useState<number | null>(null)
  const [batchName, setBatchName] = useState('')
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isOverriding, setIsOverriding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch data when dialog opens
  useEffect(() => {
    if (open) {
      fetchData()
    } else {
      setIsOverriding(false)
      setError(null)
      setBatchName('')
      setSelectedShippingId(null)
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

  // Build display list of profiles in the breakdown
  const breakdownDisplay = useMemo(() => {
    const entries: Array<{ id: number | null; name: string; count: number }> = []
    for (const [id, { count }] of shippingProfileBreakdown) {
      const method = id != null ? shippingMethods.find(m => m.idshippingprovider_profile === id) : null
      const name = method ? formatMethodName(method) : id != null ? `Profiel #${id}` : 'Geen profiel'
      entries.push({ id, name, count })
    }
    return entries
  }, [shippingProfileBreakdown, shippingMethods])

  const handleConfirm = async () => {
    if (isOverriding && !selectedShippingId) {
      setError('Selecteer een verzendprofiel')
      return
    }
    const shippingId = isOverriding ? selectedShippingId : null
    await onConfirm(shippingId, selectedPackagingId, batchName.trim() || undefined)
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
                  {/* Breakdown list */}
                  <div className="border border-border rounded-md divide-y divide-border">
                    {breakdownDisplay.map((entry) => (
                      <div key={entry.id ?? 'null'} className="flex items-center justify-between px-3 py-2 text-sm">
                        <span className="font-medium">{entry.name}</span>
                        <span className="text-muted-foreground">
                          {entry.count} {entry.count === 1 ? 'order' : 'orders'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Elke order behoudt het eigen verzendprofiel uit Picqer.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOverriding(true)
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

            {/* Packaging Section */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-muted-foreground w-32">
                  Verpakking
                </label>
                <div className="flex-1 relative">
                  <select
                    value={selectedPackagingId || ''}
                    onChange={(e) => setSelectedPackagingId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none pr-8"
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
