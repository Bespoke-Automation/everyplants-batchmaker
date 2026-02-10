'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  Package,
  Box,
  Plus,
  Truck,
  Search,
  Tag,
  ChevronRight,
  GripVertical,
  ArrowLeft,
  Loader2,
  AlertCircle,
  Send,
} from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import { usePackingSession } from '@/hooks/usePackingSession'
import type { PicqerPicklistWithProducts, PicqerPicklistProduct, PicqerPackaging } from '@/lib/picqer/types'
import ProductCard, { type ProductCardItem, type BoxRef } from './ProductCard'
import BoxCard, { type BoxCardItem, type BoxProductItem } from './BoxCard'
import ShipmentProgress from './ShipmentProgress'

interface VerpakkingsClientProps {
  sessionId: string
  onBack: () => void
  workerName: string
}

export default function VerpakkingsClient({ sessionId, onBack, workerName }: VerpakkingsClientProps) {
  // Session hook
  const {
    session,
    isLoading: isSessionLoading,
    error: sessionError,
    isSaving,
    shipProgress,
    addBox,
    updateBox,
    removeBox,
    assignProduct,
    removeProduct,
    shipAllBoxes,
  } = usePackingSession(sessionId)

  // Picklist data from Picqer
  const [picklist, setPicklist] = useState<PicqerPicklistWithProducts | null>(null)
  const [picklistLoading, setPicklistLoading] = useState(false)
  const [picklistError, setPicklistError] = useState<string | null>(null)

  // Packagings from Picqer
  const [packagings, setPackagings] = useState<PicqerPackaging[]>([])
  const [packagingsLoading, setPackagingsLoading] = useState(false)

  // Local UI state
  const [activeProduct, setActiveProduct] = useState<ProductCardItem | null>(null)
  const [showAddBoxModal, setShowAddBoxModal] = useState(false)
  const [showShipmentModal, setShowShipmentModal] = useState(false)
  const [boxSearchQuery, setBoxSearchQuery] = useState('')
  const [closedBoxes, setClosedBoxes] = useState<Set<string>>(new Set())

  // Fetch picklist when session loads
  useEffect(() => {
    if (!session?.picklistId) return

    let cancelled = false
    setPicklistLoading(true)
    setPicklistError(null)

    fetch(`/api/picqer/picklists/${session.picklistId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Picklist ophalen mislukt')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setPicklist(data.picklist)
          setPicklistLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPicklistError(err.message)
          setPicklistLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [session?.picklistId])

  // Fetch packagings once
  useEffect(() => {
    let cancelled = false
    setPackagingsLoading(true)

    fetch('/api/picqer/packagings')
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setPackagings(data.packagings ?? [])
          setPackagingsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setPackagingsLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  // Map picklist products to ProductCardItems
  // Each picklist product line becomes a card item
  // We match against session products by picqerProductId + productcode
  const productItems: ProductCardItem[] = useMemo(() => {
    if (!picklist?.products) return []

    return picklist.products.map((pp: PicqerPicklistProduct, index: number) => {
      // Find matching session product across all boxes
      let assignedBoxId: string | null = null
      let sessionProductId: string | null = null

      if (session) {
        for (const box of session.boxes) {
          const match = box.products.find(
            (sp) => sp.picqerProductId === pp.idproduct && sp.productcode === pp.productcode
          )
          if (match) {
            assignedBoxId = box.id
            sessionProductId = match.id
            break
          }
        }
      }

      // Use a stable unique ID: the session product id if assigned, otherwise index-based
      const id = sessionProductId ?? `picklist-${pp.idpicklist_product ?? index}-${pp.idproduct}`

      return {
        id,
        productCode: pp.productcode,
        name: pp.name,
        amount: pp.amount,
        amountPicked: pp.amount_picked,
        weight: 0, // Picqer picklist products don't include weight
        imageUrl: null, // Picqer picklist products don't include images
        location: '', // Not available from picklist product data
        assignedBoxId,
      }
    })
  }, [picklist, session])

  // Build BoxRef array for the ProductCard dropdown
  const boxRefs: BoxRef[] = useMemo(() => {
    if (!session) return []
    return session.boxes.map((box) => ({
      id: box.id,
      name: box.packagingName,
      index: box.boxIndex + 1,
      productCount: box.products.length,
      isClosed: closedBoxes.has(box.id),
    }))
  }, [session, closedBoxes])

  // Build BoxCardItem array for BoxCard component
  const boxItems: BoxCardItem[] = useMemo(() => {
    if (!session) return []
    return session.boxes.map((box) => ({
      id: box.id,
      packagingName: box.packagingName,
      products: box.products.map((sp): BoxProductItem => ({
        id: sp.id,
        productCode: sp.productcode,
        name: sp.productName,
        weight: (sp.weightPerUnit ?? 0) * sp.amount,
        imageUrl: null,
      })),
      isClosed: closedBoxes.has(box.id),
      shipmentCreated: box.status === 'shipped',
    }))
  }, [session, closedBoxes])

  // Filtered packagings for the add box modal
  const activePackagings = useMemo(() => {
    return packagings.filter((p) => p.active)
  }, [packagings])

  const filteredPackagings = useMemo(() => {
    if (!boxSearchQuery.trim()) return activePackagings
    const query = boxSearchQuery.toLowerCase()
    return activePackagings.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.barcode?.toLowerCase().includes(query)
    )
  }, [boxSearchQuery, activePackagings])

  // Computed values
  const assignedProductsCount = productItems.filter((p) => p.assignedBoxId !== null).length
  const totalProductsCount = productItems.length

  // Drag & drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor)
  )

  // Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const product = productItems.find((p) => p.id === event.active.id)
    if (product) {
      setActiveProduct(product)
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProduct(null)
    const { active, over } = event
    if (!over) return

    const productId = active.id as string
    const targetId = over.id as string

    // Check if dropping on a box (box IDs from session don't have a prefix)
    // The droppable is identified by box.id directly
    const targetBox = session?.boxes.find((b) => b.id === targetId)
    if (targetBox) {
      handleAssignProduct(productId, targetId)
    }
  }

  const handleAssignProduct = useCallback(
    async (productItemId: string, boxId: string) => {
      // Find the picklist product data
      const productItem = productItems.find((p) => p.id === productItemId)
      if (!productItem || !picklist) return

      // Find the original picklist product for the picqerProductId
      // Match by productcode and name
      const picklistProduct = picklist.products.find(
        (pp) => pp.productcode === productItem.productCode && pp.name === productItem.name
      )
      if (!picklistProduct) return

      await assignProduct(boxId, {
        picqerProductId: picklistProduct.idproduct,
        productcode: picklistProduct.productcode,
        productName: picklistProduct.name,
        amount: picklistProduct.amount,
      })
    },
    [productItems, picklist, assignProduct]
  )

  const handleRemoveProduct = useCallback(
    async (sessionProductId: string) => {
      await removeProduct(sessionProductId)
    },
    [removeProduct]
  )

  const handleAddBox = useCallback(
    async (packaging: PicqerPackaging) => {
      await addBox(packaging.name, packaging.idpackaging, packaging.barcode ?? undefined)
      setShowAddBoxModal(false)
      setBoxSearchQuery('')
    },
    [addBox]
  )

  const handleRemoveBox = useCallback(
    async (boxId: string) => {
      await removeBox(boxId)
    },
    [removeBox]
  )

  const handleCloseBox = useCallback((boxId: string) => {
    setClosedBoxes((prev) => new Set(prev).add(boxId))
    updateBox(boxId, { status: 'closed' })
  }, [updateBox])

  const handleReopenBox = useCallback((boxId: string) => {
    setClosedBoxes((prev) => {
      const next = new Set(prev)
      next.delete(boxId)
      return next
    })
    updateBox(boxId, { status: 'pending' })
  }, [updateBox])

  const handleShipAll = useCallback(
    (shippingProviderId: number) => {
      shipAllBoxes(shippingProviderId)
    },
    [shipAllBoxes]
  )

  // Get box name for a product
  const getBoxName = (boxId: string | null) => {
    if (!boxId || !session) return null
    const box = session.boxes.find((b) => b.id === boxId)
    return box ? box.packagingName : null
  }

  // Get box index for display
  const getBoxIndex = (boxId: string) => {
    if (!session) return null
    const box = session.boxes.find((b) => b.id === boxId)
    return box ? box.boxIndex + 1 : null
  }

  // Shipping provider ID from picklist
  const shippingProviderId = picklist?.idshippingprovider_profile ?? null

  // Loading state
  if (isSessionLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Sessie laden...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (sessionError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-red-500" />
          <p className="text-red-600 font-medium">Fout bij laden sessie</p>
          <p className="text-sm text-muted-foreground">{sessionError.message}</p>
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 min-h-[48px] text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            Terug naar wachtrij
          </button>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Geen sessie gevonden</p>
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="bg-card border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
                title="Terug naar wachtrij"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold">
                    {picklist?.picklistid ?? `Picklist #${session.picklistId}`}
                  </span>
                  <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                    {session.status === 'packing' ? 'Inpakken' : session.status}
                  </span>
                  {isSaving && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Opslaan...
                    </span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {workerName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Package className="w-4 h-4" />
                  <span>{assignedProductsCount} / {totalProductsCount} producten toegewezen</span>
                </div>
              </div>
              {/* Ship All button */}
              {session.boxes.length > 0 && (
                <button
                  onClick={() => setShowShipmentModal(true)}
                  className="flex items-center gap-2 px-4 py-2 min-h-[48px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  Alles verzenden
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Main content - two columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left column - Products */}
          <div className="w-1/2 border-r border-border flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="w-4 h-4" />
                Producten ({totalProductsCount})
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {picklistLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Producten laden...</span>
                </div>
              ) : picklistError ? (
                <div className="flex items-center justify-center py-8 text-red-500">
                  <AlertCircle className="w-5 h-5 mr-2" />
                  <span className="text-sm">{picklistError}</span>
                </div>
              ) : (
                productItems.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    boxName={getBoxName(product.assignedBoxId)}
                    boxIndex={product.assignedBoxId ? getBoxIndex(product.assignedBoxId) : null}
                    onRemoveFromBox={() => {
                      // Find the session product ID to remove
                      if (!product.assignedBoxId || !session) return
                      const box = session.boxes.find((b) => b.id === product.assignedBoxId)
                      const sessionProd = box?.products.find(
                        (sp) => sp.productcode === product.productCode && sp.productName === product.name
                      )
                      if (sessionProd) {
                        handleRemoveProduct(sessionProd.id)
                      }
                    }}
                    boxes={boxRefs}
                    onAssignToBox={(boxId) => handleAssignProduct(product.id, boxId)}
                  />
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground">
              {totalProductsCount} producten · {assignedProductsCount} toegewezen
            </div>
          </div>

          {/* Right column - Boxes */}
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h2 className="font-semibold flex items-center gap-2">
                <Box className="w-4 h-4" />
                Dozen ({session.boxes.length})
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {boxItems.map((box) => {
                const sessionBox = session.boxes.find((b) => b.id === box.id)
                return (
                  <BoxCard
                    key={box.id}
                    box={box}
                    index={sessionBox ? sessionBox.boxIndex + 1 : 1}
                    onRemoveProduct={(productId) => handleRemoveProduct(productId)}
                    onCloseBox={() => handleCloseBox(box.id)}
                    onReopenBox={() => handleReopenBox(box.id)}
                    onRemoveBox={() => handleRemoveBox(box.id)}
                    onCreateShipment={() => setShowShipmentModal(true)}
                  />
                )
              })}

              {/* Add box button */}
              <button
                onClick={() => setShowAddBoxModal(true)}
                className="w-full border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-colors group"
              >
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10">
                  <Plus className="w-6 h-6 text-muted-foreground group-hover:text-primary" />
                </div>
                <span className="font-medium text-muted-foreground group-hover:text-primary">
                  Doos toevoegen
                </span>
              </button>
            </div>
          </div>

          {/* Sidebar - Delivery info */}
          <div className="w-72 border-l border-border flex-shrink-0 bg-muted/20 overflow-y-auto hidden lg:block">
            <div className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Truck className="w-4 h-4" />
                Sessie info
              </h3>
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Medewerker</p>
                  <p className="font-medium">{workerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Picklist</p>
                  <p className="font-medium">{picklist?.picklistid ?? session.picklistId}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{session.status}</p>
                </div>
                {picklist && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Totaal producten</p>
                      <p>{picklist.totalproducts} ({picklist.totalpicked} gepickt)</p>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Details
                </h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Sessie ID</p>
                    <p className="font-mono text-xs truncate">{session.id}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Aangemaakt</p>
                    <p className="text-xs">
                      {new Date(session.createdAt).toLocaleString('nl-NL')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Dozen</p>
                    <p>{session.boxes.length}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeProduct ? (
          <div className="bg-card border border-primary shadow-lg rounded-lg p-3 opacity-90">
            <div className="flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                <Package className="w-5 h-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{activeProduct.name}</p>
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>

      {/* Add Box Modal */}
      <Dialog
        open={showAddBoxModal}
        onClose={() => {
          setShowAddBoxModal(false)
          setBoxSearchQuery('')
        }}
        title="Doos toevoegen"
        className="max-w-lg"
      >
        <div className="p-4">
          {/* Search input */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Zoek verpakking..."
              value={boxSearchQuery}
              onChange={(e) => setBoxSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
          </div>

          {/* Packaging list */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {boxSearchQuery ? `Resultaten (${filteredPackagings.length})` : `Alle verpakkingen (${activePackagings.length})`}
            </h4>
            {packagingsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Verpakkingen laden...</span>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filteredPackagings.map((pkg) => (
                  <button
                    key={pkg.idpackaging}
                    onClick={() => handleAddBox(pkg)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <div className="w-10 h-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                      <Box className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{pkg.name}</p>
                      {(pkg.length || pkg.width || pkg.height) && (
                        <p className="text-xs text-muted-foreground">
                          {pkg.length ?? '?'} x {pkg.width ?? '?'} x {pkg.height ?? '?'} cm
                        </p>
                      )}
                      {pkg.barcode && (
                        <p className="text-xs text-muted-foreground font-mono">{pkg.barcode}</p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
                {filteredPackagings.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Geen verpakkingen gevonden
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* Shipment Progress Modal */}
      <ShipmentProgress
        boxes={session.boxes}
        shipProgress={shipProgress}
        isOpen={showShipmentModal}
        onClose={() => setShowShipmentModal(false)}
        onShipAll={handleShipAll}
        shippingProviderId={shippingProviderId}
      />
    </DndContext>
  )
}
