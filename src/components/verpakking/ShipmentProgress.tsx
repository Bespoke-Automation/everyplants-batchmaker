'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Check, Loader2, AlertCircle, AlertTriangle, Clock, Download, ExternalLink, RefreshCw, CheckCircle2, ChevronDown, Truck, Search, Boxes, ChevronRight, Printer } from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import type { BoxShipmentStatus } from '@/types/verpakking'
import type { ShippingMethod } from '@/lib/picqer/types'

// Session box type (matches usePackingSession internal type)
interface SessionBox {
  id: string
  packagingName: string
  picqerPackagingId: number | null
  packagingBarcode: string | null
  boxIndex: number
  status: string
  products: Array<{
    id: string
    productName: string
    amount: number
  }>
}

type DialogPhase = 'loading' | 'configure' | 'select_method' | 'shipping' | 'error'

interface PicqerPackagingOption {
  idpackaging: number
  name: string
}

interface ShipmentProgressProps {
  boxes: SessionBox[]
  shipProgress: Map<string, BoxShipmentStatus>
  isOpen: boolean
  onClose: () => void
  onShipAll: (shippingProviderId: number, boxWeights?: Map<string, number>, packagingId?: number | null) => void
  onRetryBox: (boxId: string, shippingProviderId: number) => void
  picklistId: number | null
  defaultShippingProviderId: number | null
  boxWeights?: Map<string, number>
  onNextPicklist?: () => void
  hasNextPicklist?: boolean
  picqerPackagings?: PicqerPackagingOption[]
  defaultWeight?: number
  hasPackingStation?: boolean
  activeBoxId?: string | null
}

function getStatusIcon(status: BoxShipmentStatus['status'] | undefined) {
  switch (status) {
    case 'shipped':
    case 'labeled':
      return <Check className="w-5 h-5 text-green-600" />
    case 'shipping':
    case 'fetching_label':
      return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-600" />
    default:
      return <Clock className="w-5 h-5 text-gray-400" />
  }
}

function getStatusText(status: BoxShipmentStatus['status'] | undefined) {
  switch (status) {
    case 'shipped':
      return 'Verzonden'
    case 'labeled':
      return 'Label aangemaakt'
    case 'shipping':
      return 'Zending aanmaken...'
    case 'fetching_label':
      return 'Label ophalen...'
    case 'error':
      return 'Fout'
    default:
      return 'Wachten...'
  }
}

export default function ShipmentProgress({
  boxes,
  shipProgress,
  isOpen,
  onClose,
  onShipAll,
  onRetryBox,
  picklistId,
  defaultShippingProviderId,
  boxWeights,
  onNextPicklist,
  hasNextPicklist,
  picqerPackagings,
  defaultWeight,
  hasPackingStation,
  activeBoxId,
}: ShipmentProgressProps) {
  const [phase, setPhase] = useState<DialogPhase>('loading')
  const [methods, setMethods] = useState<ShippingMethod[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showMethodDropdown, setShowMethodDropdown] = useState(false)
  const [methodSearch, setMethodSearch] = useState('')
  const autoStartedRef = useRef(false)
  const openedLabelsRef = useRef<Set<string>>(new Set())

  // Configure phase state
  const [selectedPackagingId, setSelectedPackagingId] = useState<number | null>(null)
  const [weightInput, setWeightInput] = useState<string>('')

  // Resolved provider: what we'll use for shipping
  const resolvedProviderId = selectedProviderId ?? defaultShippingProviderId

  // Reset state when dialog opens
  useEffect(() => {
    if (!isOpen) {
      // Reset on close
      autoStartedRef.current = false
      openedLabelsRef.current = new Set()
      setShowMethodDropdown(false)
      setMethodSearch('')
      setSelectedPackagingId(null)
      setWeightInput('')
      return
    }

    // If progress exists, check if there are still unshipped boxes
    if (shipProgress.size > 0) {
      // Seed openedLabelsRef with boxes that already have labels,
      // so only NEW labels get auto-opened (not previously shipped boxes)
      for (const box of boxes) {
        const progress = shipProgress.get(box.id)
        if (progress?.labelUrl) {
          openedLabelsRef.current.add(box.id)
        }
      }

      // Check if all boxes have been processed (shipped or error)
      const allProcessed = boxes.every((box) => {
        const progress = shipProgress.get(box.id)
        return progress?.status === 'shipped' || progress?.status === 'labeled' || progress?.status === 'error'
      })

      if (allProcessed) {
        // All done or errored — show progress view
        setPhase('shipping')
        return
      }

      // There are still unprocessed boxes — show configure with existing settings
      // Keep methods and selectedProviderId from previous session (don't reset)
      setWeightInput(defaultWeight ? String(defaultWeight) : '')
      const unshippedBox = boxes.find((box) => !shipProgress.get(box.id))
      setSelectedPackagingId(unshippedBox?.picqerPackagingId ?? boxes[0]?.picqerPackagingId ?? null)
      autoStartedRef.current = false

      // If we already have methods cached, go straight to configure
      if (methods.length > 0) {
        setPhase('configure')
        return
      }
      // Otherwise fall through to fetch methods below
    }

    // No boxes to ship
    if (boxes.length === 0) {
      setPhase('error')
      setLoadError('Geen afgesloten dozen om te verzenden')
      return
    }

    // Initialize weight from default
    setWeightInput(defaultWeight ? String(defaultWeight) : '')

    // Pre-select packaging from the active box (clicked "Maak zending"), or first box
    const activeBox = activeBoxId ? boxes.find(b => b.id === activeBoxId) : null
    const initialPackagingId = activeBox?.picqerPackagingId ?? boxes[0]?.picqerPackagingId ?? null

    // Start flow: fetch shipping methods, then show configure screen
    setPhase('loading')
    setLoadError(null)
    setMethods([])
    setSelectedProviderId(null)
    setSelectedPackagingId(initialPackagingId)
    autoStartedRef.current = false

    if (!picklistId) {
      if (defaultShippingProviderId) {
        setSelectedProviderId(defaultShippingProviderId)
        setPhase('configure')
      } else {
        setPhase('error')
        setLoadError('Geen picklist ID beschikbaar om verzendmethoden op te halen')
      }
      return
    }

    // Fetch available shipping methods
    let cancelled = false
    fetch(`/api/picqer/shipping-methods?picklistId=${picklistId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Ophalen verzendmethoden mislukt')
        return res.json()
      })
      .then((data) => {
        if (cancelled) return

        const fetchedMethods: ShippingMethod[] = data.methods ?? []
        setMethods(fetchedMethods)

        if (fetchedMethods.length === 0) {
          setPhase('error')
          setLoadError('Geen verzendmethoden beschikbaar voor deze picklist. Controleer de instellingen in Picqer.')
          return
        }

        // Determine the provider to use
        const matchingMethod = defaultShippingProviderId
          ? fetchedMethods.find((m) => m.idshippingprovider_profile === defaultShippingProviderId)
          : null

        if (matchingMethod) {
          setSelectedProviderId(matchingMethod.idshippingprovider_profile)
        } else {
          setSelectedProviderId(fetchedMethods[0].idshippingprovider_profile)
        }

        // Always show configure screen first
        setPhase('configure')
      })
      .catch((err) => {
        if (cancelled) return
        if (defaultShippingProviderId) {
          setSelectedProviderId(defaultShippingProviderId)
          setPhase('configure')
        } else {
          setPhase('error')
          setLoadError(err instanceof Error ? err.message : 'Onbekende fout bij ophalen verzendmethoden')
        }
      })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Auto-print labels as they become available
  useEffect(() => {
    if (!isOpen) return
    for (const box of boxes) {
      const progress = shipProgress.get(box.id)
      if (progress?.labelUrl && !openedLabelsRef.current.has(box.id)) {
        openedLabelsRef.current.add(box.id)
        // Open in new tab and trigger print dialog
        const printWindow = window.open(progress.labelUrl, '_blank')
        if (printWindow) {
          // Wait for PDF to load, then trigger print
          printWindow.addEventListener('load', () => {
            try {
              printWindow.print()
            } catch {
              // If print fails (e.g. cross-origin), the tab is already open
            }
          })
          // Fallback: try print after a delay if load event doesn't fire
          setTimeout(() => {
            try {
              printWindow.print()
            } catch {
              // Silent fallback — tab is open for manual print
            }
          }, 1500)
        }
      }
    }
  }, [isOpen, boxes, shipProgress])

  const handleStartShipping = useCallback(() => {
    if (!resolvedProviderId) return
    // Build weight map from the weight input
    const weight = weightInput ? parseInt(weightInput, 10) : undefined
    const weightMap = weight ? new Map(boxes.map(b => [b.id, weight])) : boxWeights
    setPhase('shipping')
    autoStartedRef.current = true
    onShipAll(resolvedProviderId, weightMap, selectedPackagingId)
  }, [resolvedProviderId, onShipAll, boxWeights, boxes, weightInput, selectedPackagingId])

  const handleStartWithSelectedMethod = useCallback(() => {
    handleStartShipping()
  }, [handleStartShipping])

  const handleRetryBox = useCallback((boxId: string) => {
    if (!resolvedProviderId) return
    onRetryBox(boxId, resolvedProviderId)
  }, [resolvedProviderId, onRetryBox])

  // Progress calculations
  const shippedCount = boxes.filter((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'shipped' || progress?.status === 'labeled'
  }).length

  const hasErrors = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'error'
  })

  const totalBoxes = boxes.length
  const progressPercentage = totalBoxes > 0 ? Math.round((shippedCount / totalBoxes) * 100) : 0
  const allDone = shippedCount === totalBoxes && totalBoxes > 0

  const isShipping = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'shipping' || progress?.status === 'fetching_label'
  })

  const sessionCompleted = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.sessionCompleted === true
  })

  // Detect if multicollo was used (stored as extra prop on first box's progress)
  const isMulticollo = boxes.some((box) => {
    const progress = shipProgress.get(box.id) as (BoxShipmentStatus & { multicollo?: boolean }) | undefined
    return progress?.multicollo === true
  })

  const labelUrls = boxes
    .map((box) => shipProgress.get(box.id))
    .filter((p): p is BoxShipmentStatus => !!p && !!p.labelUrl)
    .map((p) => p.labelUrl!)

  const handleDownloadAllLabels = () => {
    for (const url of labelUrls) {
      window.open(url, '_blank')
    }
  }

  // Find selected method name for display
  const selectedMethodName = methods.find(
    (m) => m.idshippingprovider_profile === resolvedProviderId
  )?.name

  // Filter and group methods for the selection screen
  const filteredMethods = useMemo(() => {
    if (!methodSearch.trim()) return methods
    const q = methodSearch.toLowerCase()
    return methods.filter(
      (m) => m.name.toLowerCase().includes(q) || m.carrier?.toLowerCase().includes(q)
    )
  }, [methods, methodSearch])

  const groupedMethods = useMemo(() => {
    const groups: { carrier: string; methods: ShippingMethod[] }[] = []
    const carrierMap = new Map<string, ShippingMethod[]>()

    for (const method of filteredMethods) {
      // Skip the default method — it's shown separately at the top
      if (method.idshippingprovider_profile === defaultShippingProviderId) continue
      const carrier = method.carrier || 'Overig'
      if (!carrierMap.has(carrier)) carrierMap.set(carrier, [])
      carrierMap.get(carrier)!.push(method)
    }

    for (const [carrier, items] of carrierMap) {
      groups.push({ carrier, methods: items })
    }
    groups.sort((a, b) => a.carrier.localeCompare(b.carrier))
    return groups
  }, [filteredMethods, defaultShippingProviderId])

  const defaultMethod = methods.find(
    (m) => m.idshippingprovider_profile === defaultShippingProviderId
  )

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Zendingen maken"
      className="max-w-2xl"
    >
      <div className="p-6 sm:p-8">
        {/* Phase: Loading */}
        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Verzendmethoden ophalen...</p>
          </div>
        )}

        {/* Phase: Error */}
        {phase === 'error' && (
          <div className="py-4">
            <div className="flex items-start gap-2 px-3 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <span>{loadError}</span>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 min-h-[48px] text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Sluiten
              </button>
            </div>
          </div>
        )}

        {/* Phase: Configure shipment (like Picqer's modal) */}
        {phase === 'configure' && (
          <div className="space-y-6">
            {/* Verzendprofiel */}
            <div className="flex items-center justify-between gap-4 min-h-[56px]">
              <span className="text-lg text-muted-foreground flex-shrink-0">Verzendprofiel</span>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg font-medium truncate">
                  {methods.find(m => m.idshippingprovider_profile === resolvedProviderId)?.name || 'Onbekend'}
                </span>
                {methods.length > 1 && (
                  <button
                    onClick={() => setPhase('select_method')}
                    className="px-5 py-2.5 text-lg text-primary border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors min-h-[52px]"
                  >
                    Wijzig
                  </button>
                )}
              </div>
            </div>

            {/* Verpakking */}
            {picqerPackagings && picqerPackagings.length > 0 && (
              <div className="flex items-center justify-between gap-4 min-h-[56px]">
                <label htmlFor="shipment-packaging" className="text-lg text-muted-foreground flex-shrink-0">Verpakking</label>
                <select
                  id="shipment-packaging"
                  value={selectedPackagingId ?? ''}
                  onChange={(e) => setSelectedPackagingId(e.target.value ? Number(e.target.value) : null)}
                  className="flex-1 min-w-0 px-4 py-3.5 text-lg border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary min-h-[56px]"
                >
                  <option value="">Geen</option>
                  {picqerPackagings.map((p) => (
                    <option key={p.idpackaging} value={p.idpackaging}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Gewicht */}
            <div className="flex items-center justify-between min-h-[56px]">
              <label htmlFor="shipment-weight" className="text-lg text-muted-foreground">Gewicht</label>
              <div className="flex items-center gap-2">
                <input
                  id="shipment-weight"
                  type="number"
                  inputMode="numeric"
                  value={weightInput}
                  onChange={(e) => setWeightInput(e.target.value)}
                  placeholder="0"
                  className="w-32 px-4 py-3.5 text-lg text-right border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary min-h-[56px]"
                />
                <span className="text-lg text-muted-foreground">gram</span>
              </div>
            </div>

            {/* Aantal pakketten */}
            <div className="flex items-center justify-between min-h-[56px]">
              <span className="text-lg text-muted-foreground">Aantal pakketten</span>
              <span className="text-lg font-medium">{boxes.length}</span>
            </div>

            {/* No packing station warning */}
            {!hasPackingStation && (
              <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-lg text-base text-amber-800">
                <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <span>Geen werkstation geselecteerd. Labels worden niet automatisch geprint.</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-6 border-t border-border gap-4">
              <button
                onClick={onClose}
                className="px-6 py-4 min-h-[56px] text-lg rounded-lg hover:bg-muted transition-colors"
              >
                Annuleren
              </button>
              <button
                onClick={handleStartShipping}
                disabled={!resolvedProviderId}
                className="flex-1 max-w-[280px] py-4 min-h-[56px] bg-primary text-primary-foreground rounded-lg text-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Zending maken
              </button>
            </div>
          </div>
        )}

        {/* Phase: Select method */}
        {phase === 'select_method' && (
          <div className="py-2">
            <p className="text-sm text-muted-foreground mb-3">
              Kies een verzendmethode ({methods.length} beschikbaar)
            </p>

            {/* Default/recommended method — always visible at top */}
            {defaultMethod && !methodSearch.trim() && (
              <div className="mb-3">
                <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wider mb-1.5">
                  Aanbevolen
                </p>
                <button
                  onClick={() => setSelectedProviderId(defaultMethod.idshippingprovider_profile)}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    defaultMethod.idshippingprovider_profile === resolvedProviderId
                      ? 'border-green-500 bg-green-50 ring-1 ring-green-500'
                      : 'border-green-200 bg-green-50/50 hover:border-green-400'
                  }`}
                >
                  <Truck className="w-5 h-5 flex-shrink-0 text-green-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{defaultMethod.name}</p>
                    {defaultMethod.carrier && (
                      <p className="text-xs text-muted-foreground">{defaultMethod.carrier}</p>
                    )}
                  </div>
                  {defaultMethod.idshippingprovider_profile === resolvedProviderId && (
                    <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                  )}
                </button>
              </div>
            )}

            {/* Search input */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Zoek verzendmethode..."
                value={methodSearch}
                onChange={(e) => setMethodSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Grouped methods list */}
            <div className="max-h-[300px] overflow-y-auto space-y-3 mb-4">
              {groupedMethods.length === 0 && filteredMethods.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Geen methoden gevonden
                </p>
              )}
              {/* If searching and default matches, show it in results too */}
              {methodSearch.trim() && defaultMethod && (
                defaultMethod.name.toLowerCase().includes(methodSearch.toLowerCase()) ||
                defaultMethod.carrier?.toLowerCase().includes(methodSearch.toLowerCase())
              ) && (
                <button
                  onClick={() => setSelectedProviderId(defaultMethod.idshippingprovider_profile)}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                    defaultMethod.idshippingprovider_profile === resolvedProviderId
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <Truck className={`w-4 h-4 flex-shrink-0 ${
                    defaultMethod.idshippingprovider_profile === resolvedProviderId ? 'text-primary' : 'text-muted-foreground'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{defaultMethod.name}</p>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex-shrink-0">
                    Standaard
                  </span>
                  {defaultMethod.idshippingprovider_profile === resolvedProviderId && (
                    <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  )}
                </button>
              )}
              {groupedMethods.map((group) => (
                <div key={group.carrier}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                    {group.carrier}
                  </p>
                  <div className="space-y-1">
                    {group.methods.map((method) => {
                      const isSelected = method.idshippingprovider_profile === resolvedProviderId
                      return (
                        <button
                          key={method.idshippingprovider_profile}
                          onClick={() => setSelectedProviderId(method.idshippingprovider_profile)}
                          className={`w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border hover:border-primary/50 hover:bg-muted/50'
                          }`}
                        >
                          <Truck className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                          <p className={`text-sm flex-1 min-w-0 truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                            {method.name}
                          </p>
                          {isSelected && (
                            <Check className="w-4 h-4 text-primary flex-shrink-0" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
              <button
                onClick={onClose}
                className="px-4 py-2 min-h-[48px] text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Annuleren
              </button>
              <button
                onClick={() => setPhase('configure')}
                disabled={!resolvedProviderId}
                className="px-6 py-2.5 min-h-[48px] bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                Bevestigen
              </button>
            </div>
          </div>
        )}

        {/* Phase: Shipping progress */}
        {phase === 'shipping' && (
          <>
            {/* Selected method indicator */}
            {selectedMethodName && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-muted/50 rounded-lg text-sm">
                <Truck className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Verzendmethode:</span>
                <span className="font-medium">{selectedMethodName}</span>
                {methods.length > 1 && !isShipping && !allDone && (
                  <div className="relative ml-auto">
                    <button
                      onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                      className="text-xs text-primary hover:underline flex items-center gap-0.5"
                    >
                      Wijzig
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showMethodDropdown && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setShowMethodDropdown(false)} />
                        <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[200px]">
                          <div className="p-1">
                            {methods.map((method) => (
                              <button
                                key={method.idshippingprovider_profile}
                                onClick={() => {
                                  setSelectedProviderId(method.idshippingprovider_profile)
                                  setShowMethodDropdown(false)
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg transition-colors text-left ${
                                  method.idshippingprovider_profile === resolvedProviderId
                                    ? 'bg-primary/10 text-primary font-medium'
                                    : 'hover:bg-muted'
                                }`}
                              >
                                {method.name}
                                {method.idshippingprovider_profile === defaultShippingProviderId && (
                                  <span className="text-[10px] px-1 py-0.5 bg-green-100 text-green-700 rounded ml-auto">
                                    Standaard
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Multicollo badge */}
            {isMulticollo && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg text-sm text-purple-800">
                <Boxes className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">Multicollo zending</span>
                <span className="text-xs text-purple-600">({totalBoxes} pakketten in één zending)</span>
              </div>
            )}

            {/* Progress bar - prominent */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="text-muted-foreground">
                  {allDone ? 'Alle dozen verzonden!' : `${shippedCount}/${totalBoxes} dozen verzonden`}
                </span>
                <span className="font-semibold text-lg">{progressPercentage}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all duration-500 ${
                    hasErrors ? 'bg-amber-500' : allDone ? 'bg-green-500' : 'bg-primary'
                  }`}
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            {/* Box list */}
            <div className="space-y-2 mb-4">
              {boxes.map((box, i) => {
                const progress = shipProgress.get(box.id)
                const status = progress?.status

                return (
                  <div
                    key={box.id}
                    className={`border rounded-lg p-3 ${
                      status === 'shipped' || status === 'labeled'
                        ? 'border-green-200 bg-green-50/50'
                        : status === 'error'
                        ? 'border-red-200 bg-red-50/50'
                        : status === 'shipping' || status === 'fetching_label'
                        ? 'border-blue-200 bg-blue-50/50'
                        : 'border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(status)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">
                          Doos {i + 1}: {box.packagingName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {getStatusText(status)}
                          {progress?.trackingCode && (
                            <span className="ml-1 font-mono">{progress.trackingCode}</span>
                          )}
                        </p>
                        {progress?.error && (
                          <p className="text-xs text-red-600 mt-1">{progress.error}</p>
                        )}
                        {progress?.warning && (
                          <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                            <span>{progress.warning}</span>
                          </p>
                        )}
                      </div>
                      {status === 'error' && (
                        <button
                          onClick={() => handleRetryBox(box.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors flex-shrink-0"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Opnieuw
                        </button>
                      )}
                      {progress?.labelUrl && (
                        <a
                          href={progress.labelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                        >
                          <Download className="w-3 h-3" />
                          Label
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* All done banner */}
            {allDone && (
              <div className="mb-4 flex items-start gap-2 px-3 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                <CheckCircle2 className="w-5 h-5 mt-0.5 flex-shrink-0 text-green-600" />
                <div className="flex-1">
                  <p className="font-semibold">Alle zendingen aangemaakt</p>
                  {sessionCompleted && (
                    <p className="mt-0.5 text-green-700">Picklist is afgesloten in Picqer</p>
                  )}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-border">
              {/* Left side: label actions + reconfigure */}
              <div className="flex items-center gap-2">
                {labelUrls.length > 0 && (
                  <button
                    onClick={handleDownloadAllLabels}
                    className="flex items-center gap-2 px-3 py-2 min-h-[48px] text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    Labels printen
                  </button>
                )}
                {hasErrors && !isShipping && (
                  <button
                    onClick={() => setPhase('configure')}
                    className="flex items-center gap-1.5 px-3 py-2 min-h-[48px] text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                  >
                    Instellingen wijzigen
                  </button>
                )}
              </div>

              {/* Right side: next or close */}
              <div className="flex items-center gap-2">
                {allDone && hasNextPicklist && onNextPicklist ? (
                  <>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 min-h-[48px] text-sm rounded-lg hover:bg-muted transition-colors"
                    >
                      Sluiten
                    </button>
                    <button
                      onClick={onNextPicklist}
                      className="flex items-center gap-2 px-5 py-2.5 min-h-[48px] bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                    >
                      Volgende order
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onClose}
                    disabled={isShipping}
                    className={`px-4 py-2 min-h-[48px] text-sm rounded-lg transition-colors ${
                      isShipping
                        ? 'text-muted-foreground bg-muted cursor-not-allowed'
                        : allDone
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium'
                        : 'hover:bg-muted'
                    }`}
                  >
                    {allDone ? 'Klaar' : 'Sluiten'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
