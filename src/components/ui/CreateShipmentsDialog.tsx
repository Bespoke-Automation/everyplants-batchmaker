'use client'

import { useState, useEffect } from 'react'
import { Loader2, ChevronDown } from 'lucide-react'
import Dialog from './Dialog'

interface ShippingMethod {
  idshippingprovider_profile: number
  name: string
  carrier?: string  // Optional - may not be returned by Picqer API
}

interface Packaging {
  idpackaging: number
  name: string
}

interface CreateShipmentsDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (shippingProviderId: number, packagingId: number | null, name?: string) => Promise<void>
  totalOrders: number
  totalGroups: number
  defaultShippingProviderId: number | null
  firstPicklistId: number | null
  isLoading: boolean
}

export default function CreateShipmentsDialog({
  open,
  onClose,
  onConfirm,
  totalOrders,
  totalGroups,
  defaultShippingProviderId,
  firstPicklistId,
  isLoading,
}: CreateShipmentsDialogProps) {
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([])
  const [packagings, setPackagings] = useState<Packaging[]>([])
  const [selectedShippingId, setSelectedShippingId] = useState<number | null>(null)
  const [selectedPackagingId, setSelectedPackagingId] = useState<number | null>(null)
  const [batchName, setBatchName] = useState('')
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [isChangingShipping, setIsChangingShipping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wasAutoSelected, setWasAutoSelected] = useState(false)

  // Fetch data when dialog opens
  useEffect(() => {
    if (open) {
      fetchData()
    } else {
      // Reset state when dialog closes
      setIsChangingShipping(false)
      setError(null)
      setWasAutoSelected(false)
      setBatchName('')
    }
  }, [open, firstPicklistId])

  // Set default shipping ID when methods are loaded
  useEffect(() => {
    if (shippingMethods.length > 0) {
      if (defaultShippingProviderId) {
        // Check if the default ID exists in the available methods
        const exists = shippingMethods.some(m => m.idshippingprovider_profile === defaultShippingProviderId)
        if (exists) {
          setSelectedShippingId(defaultShippingProviderId)
          setWasAutoSelected(false)
        } else {
          // Fall back to first available method
          setSelectedShippingId(shippingMethods[0].idshippingprovider_profile)
          setWasAutoSelected(true)
        }
      } else {
        // No default - use first available method
        setSelectedShippingId(shippingMethods[0].idshippingprovider_profile)
        setWasAutoSelected(true)
      }
    }
  }, [shippingMethods, defaultShippingProviderId])

  const fetchData = async () => {
    setIsLoadingData(true)
    setError(null)

    try {
      // Fetch packagings and shipping methods in parallel
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

  const selectedMethod = shippingMethods.find(m => m.idshippingprovider_profile === selectedShippingId)

  // Format shipping method display name
  const formatMethodName = (method: ShippingMethod) => {
    if (method.carrier) {
      return `${method.carrier} - ${method.name}`
    }
    return method.name
  }

  const handleConfirm = async () => {
    if (!selectedShippingId) {
      setError('Selecteer een verzendprofiel')
      return
    }
    await onConfirm(selectedShippingId, selectedPackagingId, batchName.trim() || undefined)
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
            <div className="space-y-1">
              <div className="flex items-start justify-between">
                <label className="text-sm font-medium text-muted-foreground w-32 pt-1">
                  Verzendprofiel
                </label>
                <div className="flex-1">
                  {isChangingShipping ? (
                    <select
                      value={selectedShippingId || ''}
                      onChange={(e) => {
                        setSelectedShippingId(Number(e.target.value))
                        setIsChangingShipping(false)
                      }}
                      className="w-full px-3 py-2 border border-border rounded-md bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      {shippingMethods.map((method) => (
                        <option key={method.idshippingprovider_profile} value={method.idshippingprovider_profile}>
                          {formatMethodName(method)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {selectedMethod ? formatMethodName(selectedMethod) : 'Geen profiel geselecteerd'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsChangingShipping(true)}
                          className="text-primary text-sm hover:underline"
                        >
                          Wijzig
                        </button>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {wasAutoSelected
                          ? 'Automatisch geselecteerd (geen standaard profiel ingesteld)'
                          : 'Dit profiel is voorgeselecteerd'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
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
            disabled={isLoading || isLoadingData || !selectedShippingId}
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
