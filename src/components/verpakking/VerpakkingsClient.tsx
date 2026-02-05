'use client'

import { useState, useMemo } from 'react'
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
  Check,
  Plus,
  Truck,
  X,
  Search,
  MapPin,
  Tag,
  Weight,
  ChevronRight,
  GripVertical,
} from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import type { Box as BoxType, PackagingType, Picklist, PicklistProduct } from '@/types/verpakking'
import {
  MOCK_PICKLIST,
  MOCK_PACKAGING_TYPES,
  MOCK_SHIPPING_PROFILES,
  RECENTLY_USED_PACKAGING_IDS,
} from '@/data/mockVerpakkingData'
import ProductCard from './ProductCard'
import BoxCard from './BoxCard'

export default function VerpakkingsClient() {
  // State
  const [picklist] = useState<Picklist>(MOCK_PICKLIST)
  const [products, setProducts] = useState<PicklistProduct[]>(MOCK_PICKLIST.products)
  const [boxes, setBoxes] = useState<BoxType[]>([])
  const [activeProduct, setActiveProduct] = useState<PicklistProduct | null>(null)

  // Modals
  const [showAddBoxModal, setShowAddBoxModal] = useState(false)
  const [showShipmentModal, setShowShipmentModal] = useState(false)
  const [selectedBoxForShipment, setSelectedBoxForShipment] = useState<BoxType | null>(null)

  // Search
  const [boxSearchQuery, setBoxSearchQuery] = useState('')

  // Drag & drop sensors (support for mouse, touch, and keyboard)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor)
  )

  // Filtered packaging types based on search
  const filteredPackagingTypes = useMemo(() => {
    if (!boxSearchQuery.trim()) {
      return MOCK_PACKAGING_TYPES
    }
    const query = boxSearchQuery.toLowerCase()
    return MOCK_PACKAGING_TYPES.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.barcode?.toLowerCase().includes(query)
    )
  }, [boxSearchQuery])

  // Recently used packaging types
  const recentlyUsedPackaging = useMemo(() => {
    return RECENTLY_USED_PACKAGING_IDS.map((id) =>
      MOCK_PACKAGING_TYPES.find((pkg) => pkg.id === id)
    ).filter(Boolean) as PackagingType[]
  }, [])

  // Computed values
  const assignedProductsCount = products.filter((p) => p.assignedBoxId).length
  const totalProductsCount = products.length
  const totalWeight = products.reduce((sum, p) => sum + p.weight, 0)

  // Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const product = products.find((p) => p.id === event.active.id)
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

    // Check if dropping on a box
    if (targetId.startsWith('box-')) {
      assignProductToBox(productId, targetId)
    }
  }

  const assignProductToBox = (productId: string, boxId: string) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, assignedBoxId: boxId, amountPicked: p.amount } : p
      )
    )
    // Also update the box's products list
    setBoxes((prev) =>
      prev.map((box) => {
        if (box.id === boxId) {
          const product = products.find((p) => p.id === productId)
          if (product && !box.products.find((p) => p.id === productId)) {
            return { ...box, products: [...box.products, { ...product, assignedBoxId: boxId }] }
          }
        }
        return box
      })
    )
  }

  const handleProductClick = (product: PicklistProduct, boxId: string) => {
    // Button-based assignment for touch/accessibility
    assignProductToBox(product.id, boxId)
  }

  const removeProductFromBox = (productId: string) => {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, assignedBoxId: null, amountPicked: 0 } : p
      )
    )
    setBoxes((prev) =>
      prev.map((box) => ({
        ...box,
        products: box.products.filter((p) => p.id !== productId),
      }))
    )
  }

  const addBox = (packagingType: PackagingType) => {
    const newBox: BoxType = {
      id: `box-${Date.now()}`,
      packagingType,
      products: [],
      isClosed: false,
      shipmentCreated: false,
      shipmentId: null,
    }
    setBoxes((prev) => [...prev, newBox])
    setShowAddBoxModal(false)
    setBoxSearchQuery('')
  }

  const removeBox = (boxId: string) => {
    // Unassign all products from this box first
    const boxProducts = boxes.find((b) => b.id === boxId)?.products || []
    boxProducts.forEach((p) => {
      removeProductFromBox(p.id)
    })
    setBoxes((prev) => prev.filter((b) => b.id !== boxId))
  }

  const closeBox = (boxId: string) => {
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === boxId ? { ...box, isClosed: true } : box
      )
    )
  }

  const reopenBox = (boxId: string) => {
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === boxId ? { ...box, isClosed: false } : box
      )
    )
  }

  const openShipmentModal = (box: BoxType) => {
    setSelectedBoxForShipment(box)
    setShowShipmentModal(true)
  }

  const createShipment = () => {
    if (!selectedBoxForShipment) return

    // Mark shipment as created (in real app, this would call Picqer API)
    setBoxes((prev) =>
      prev.map((box) =>
        box.id === selectedBoxForShipment.id
          ? { ...box, shipmentCreated: true, shipmentId: `SHIP-${Date.now()}` }
          : box
      )
    )
    setShowShipmentModal(false)
    setSelectedBoxForShipment(null)
  }

  // Get box name for a product
  const getBoxName = (boxId: string | null) => {
    if (!boxId) return null
    const box = boxes.find((b) => b.id === boxId)
    return box ? box.packagingType.name : null
  }

  // Get box index for display
  const getBoxIndex = (boxId: string) => {
    return boxes.findIndex((b) => b.id === boxId) + 1
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-full">
        {/* Header with picklist info */}
        <div className="bg-card border-b border-border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold">{picklist.picklistNumber}</span>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                  Open
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                Toegewezen aan Niemand
              </p>
            </div>
            <div className="text-right text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Package className="w-4 h-4" />
                <span>{assignedProductsCount} / {totalProductsCount} producten toegewezen</span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Weight className="w-4 h-4" />
                <span>{(totalWeight / 1000).toFixed(2)} kg totaal</span>
              </div>
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
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  boxName={getBoxName(product.assignedBoxId)}
                  boxIndex={product.assignedBoxId ? getBoxIndex(product.assignedBoxId) : null}
                  onRemoveFromBox={() => removeProductFromBox(product.id)}
                  boxes={boxes.filter((b) => !b.isClosed)}
                  onAssignToBox={(boxId) => handleProductClick(product, boxId)}
                />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-border bg-muted/30 text-sm text-muted-foreground">
              {totalProductsCount} producten · Gewicht {(totalWeight / 1000).toFixed(2)}kg
            </div>
          </div>

          {/* Right column - Boxes */}
          <div className="w-1/2 flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <h2 className="font-semibold flex items-center gap-2">
                <Box className="w-4 h-4" />
                Dozen ({boxes.length})
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {boxes.map((box, index) => (
                <BoxCard
                  key={box.id}
                  box={box}
                  index={index + 1}
                  onRemoveProduct={removeProductFromBox}
                  onCloseBox={() => closeBox(box.id)}
                  onReopenBox={() => reopenBox(box.id)}
                  onRemoveBox={() => removeBox(box.id)}
                  onCreateShipment={() => openShipmentModal(box)}
                />
              ))}

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
                Bezorging
              </h3>
              <div className="space-y-1 text-sm">
                {picklist.deliveryAddress.company && (
                  <p className="font-medium">{picklist.deliveryAddress.company}</p>
                )}
                <p>{picklist.deliveryAddress.name}</p>
                <p>{picklist.deliveryAddress.street}</p>
                <p>
                  {picklist.deliveryAddress.postalCode} {picklist.deliveryAddress.city}
                </p>
                <p>{picklist.deliveryAddress.country}</p>
                <button className="text-primary hover:underline text-xs mt-2">
                  Bewerk adres
                </button>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs text-muted-foreground">Verzendprofiel (voorgeselecteerd)</p>
                <p className="text-sm font-medium">{picklist.shippingProfile?.name}</p>
              </div>

              <div className="mt-4 pt-4 border-t border-border">
                <h4 className="font-semibold mb-3 flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  Details
                </h4>
                <div className="space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Bestelling</p>
                    <p className="text-primary">{picklist.orderId}</p>
                    <p className="text-xs text-muted-foreground">
                      op {new Date(picklist.created).toLocaleDateString('nl-NL')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Referentie</p>
                    <p>{picklist.orderReference}</p>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {picklist.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 text-xs bg-muted rounded-full border border-border"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2">
                    <p className="text-xs text-muted-foreground">Retailer Naam</p>
                    <p>{picklist.retailerName}</p>
                  </div>
                  {picklist.retailerOrderNumber && (
                    <div>
                      <p className="text-xs text-muted-foreground">Retailer Ordernummer</p>
                      <p>{picklist.retailerOrderNumber}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Comments section */}
        <div className="border-t border-border px-4 py-3 bg-card">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">
              KL
            </div>
            <input
              type="text"
              placeholder="Plaats een interne opmerking"
              className="flex-1 bg-muted rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeProduct ? (
          <div className="bg-card border border-primary shadow-lg rounded-lg p-3 opacity-90">
            <div className="flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              {activeProduct.imageUrl ? (
                <img
                  src={activeProduct.imageUrl}
                  alt={activeProduct.name}
                  className="w-10 h-10 rounded object-cover"
                />
              ) : (
                <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
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

          {/* Recently used */}
          {!boxSearchQuery && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Recent gebruikt
              </h4>
              <div className="space-y-1">
                {recentlyUsedPackaging.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => addBox(pkg)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                  >
                    <img
                      src={pkg.imageUrl}
                      alt={pkg.name}
                      className="w-10 h-10 rounded object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{pkg.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {pkg.length} x {pkg.width} x {pkg.height} cm
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* All packaging types */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {boxSearchQuery ? `Resultaten (${filteredPackagingTypes.length})` : 'Alle verpakkingen'}
            </h4>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredPackagingTypes.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => addBox(pkg)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left"
                >
                  <img
                    src={pkg.imageUrl}
                    alt={pkg.name}
                    className="w-10 h-10 rounded object-cover"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.length} x {pkg.width} x {pkg.height} cm · max {(pkg.maxWeight / 1000).toFixed(0)}kg
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              ))}
              {filteredPackagingTypes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Geen verpakkingen gevonden
                </p>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Shipment Modal */}
      <Dialog
        open={showShipmentModal}
        onClose={() => {
          setShowShipmentModal(false)
          setSelectedBoxForShipment(null)
        }}
        title="Zending maken"
        className="max-w-md"
      >
        {selectedBoxForShipment && (
          <div className="p-4">
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground">Verzendprofiel</label>
                <div className="flex items-center justify-between mt-1">
                  <div>
                    <p className="font-medium">{picklist.shippingProfile?.name}</p>
                    <p className="text-xs text-muted-foreground">Dit profiel is voorgeselecteerd</p>
                  </div>
                  <button className="text-primary text-sm hover:underline">Wijzig</button>
                </div>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">Verpakking</label>
                <select className="w-full mt-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary">
                  <option value={selectedBoxForShipment.packagingType.id}>
                    {selectedBoxForShipment.packagingType.name}
                  </option>
                  <option value="">Geen</option>
                </select>
              </div>

              <div>
                <label className="text-sm text-muted-foreground">Gewicht</label>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    defaultValue={selectedBoxForShipment.products.reduce((sum, p) => sum + p.weight, 0)}
                    className="flex-1 px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground">gram</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-amber-600">
                <MapPin className="w-4 h-4" />
                <span>Geen pakstation</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <button
                onClick={() => {
                  setShowShipmentModal(false)
                  setSelectedBoxForShipment(null)
                }}
                className="px-4 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Annuleren
              </button>
              <button
                onClick={createShipment}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Zending maken
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </DndContext>
  )
}
