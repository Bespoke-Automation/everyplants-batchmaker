'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
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
  ChevronDown,
  GripVertical,
  ArrowLeft,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Send,
  Info,
  X,
  MapPin,
  MessageSquare,
  RefreshCw,
  ScanBarcode,
} from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import { usePackingSession } from '@/hooks/usePackingSession'
import { useTagMappings } from '@/hooks/useTagMappings'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import { usePicklistComments, type PicklistComment } from '@/hooks/usePicklistComments'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import type { PicqerPicklistWithProducts, PicqerPicklistProduct, PicqerPackaging, PicqerOrder } from '@/lib/picqer/types'
import BarcodeListener from './BarcodeListener'
import ProductCard, { type ProductCardItem, type BoxRef } from './ProductCard'
import BoxCard, { type BoxCardItem, type BoxProductItem } from './BoxCard'
import ShipmentProgress from './ShipmentProgress'

// Shared status translation map (English -> Dutch)
const STATUS_TRANSLATIONS: Record<string, string> = {
  claimed: 'Geclaimd',
  assigned: 'Toegewezen',
  packing: 'Inpakken',
  shipping: 'Verzenden',
  completed: 'Voltooid',
  failed: 'Mislukt',
  pending: 'Wachtend',
  open: 'Open',
  closed: 'Afgesloten',
  shipment_created: 'Zending aangemaakt',
  label_fetched: 'Label opgehaald',
  shipped: 'Verzonden',
  error: 'Fout',
}

function translateStatus(status: string): string {
  return STATUS_TRANSLATIONS[status] ?? status
}

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
    warnings,
    addBox,
    updateBox,
    removeBox,
    assignProduct,
    removeProduct,
    shipBox,
    shipAllBoxes,
    dismissWarning,
  } = usePackingSession(sessionId)

  // Picqer users for @ mentions
  const { users: picqerUsers } = usePicqerUsers()

  // Picklist data from Picqer
  const [picklist, setPicklist] = useState<PicqerPicklistWithProducts | null>(null)
  const [picklistLoading, setPicklistLoading] = useState(false)
  const [picklistError, setPicklistError] = useState<string | null>(null)

  // Order data from Picqer (delivery address etc.)
  const [order, setOrder] = useState<PicqerOrder | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)

  // Packagings from Picqer
  const [packagings, setPackagings] = useState<PicqerPackaging[]>([])
  const [packagingsLoading, setPackagingsLoading] = useState(false)

  // Tag-to-packaging mappings for suggestions
  const { getMappingsForTags, isLoading: mappingsLoading } = useTagMappings()

  // Picklist comments
  const picklistIdForComments = picklist?.idpicklist ?? null
  const {
    comments: picklistComments,
    isLoading: isLoadingComments,
    fetchComments,
    addComment: addPicklistComment,
    deleteComment: deletePicklistComment,
  } = usePicklistComments(picklistIdForComments)

  // Leave session confirmation
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  // Sidebar expanded panels
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set(['delivery', 'details']))

  // Barcode scanner state
  const [scanFeedback, setScanFeedback] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null)
  const [highlightProductId, setHighlightProductId] = useState<string | null>(null)

  // Multi-select state
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  const [showBulkAssignMenu, setShowBulkAssignMenu] = useState(false)
  const [isBulkAssigning, setIsBulkAssigning] = useState(false)

  // Local UI state
  const [activeProduct, setActiveProduct] = useState<ProductCardItem | null>(null)
  const [showAddBoxModal, setShowAddBoxModal] = useState(false)
  const [showShipmentModal, setShowShipmentModal] = useState(false)
  const [boxSearchQuery, setBoxSearchQuery] = useState('')
  const [closedBoxes, setClosedBoxes] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'products' | 'boxes'>('products')
  const [showSessionInfo, setShowSessionInfo] = useState(false)

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

  // Fetch order when picklist loads (for delivery address)
  useEffect(() => {
    if (!picklist?.idorder) return

    let cancelled = false
    setOrderLoading(true)

    fetch(`/api/picqer/orders/${picklist.idorder}`)
      .then((res) => {
        if (!res.ok) throw new Error('Order ophalen mislukt')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) {
          setOrder(data.order)
          setOrderLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setOrderLoading(false)
      })

    return () => { cancelled = true }
  }, [picklist?.idorder])

  // Fetch picklist comments once when picklist loads
  useEffect(() => {
    if (picklistIdForComments) {
      fetchComments()
    }
  }, [picklistIdForComments, fetchComments])

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

  // Auto-box state (refs + state declared early, effect runs after suggestedPackagings)
  const autoBoxCreatedRef = useRef(false)
  const [autoBoxMessage, setAutoBoxMessage] = useState<string | null>(null)

  // Auto-dismiss warnings after 8 seconds
  useEffect(() => {
    if (warnings.length === 0) return
    const timer = setTimeout(() => {
      dismissWarning(0)
    }, 8000)
    return () => clearTimeout(timer)
  }, [warnings, dismissWarning])

  // Map picklist products to ProductCardItems (supports split assignments across boxes)
  const productItems: ProductCardItem[] = useMemo(() => {
    if (!picklist?.products) return []

    return picklist.products.map((pp: PicqerPicklistProduct, index: number) => {
      // Collect all box assignments for this product
      const assignments: { boxId: string; boxName: string; boxIndex: number; amount: number; sessionProductId: string }[] = []
      if (session) {
        for (const box of session.boxes) {
          const matches = box.products.filter(
            (sp) => sp.picqerProductId === pp.idproduct && sp.productcode === pp.productcode
          )
          for (const match of matches) {
            assignments.push({
              boxId: box.id,
              boxName: box.packagingName,
              boxIndex: box.boxIndex + 1,
              amount: match.amount,
              sessionProductId: match.id,
            })
          }
        }
      }

      const amountAssigned = assignments.reduce((sum, a) => sum + a.amount, 0)
      // Fully assigned → mark with first box ID; partially/unassigned → null (stays in unassigned list)
      const assignedBoxId = amountAssigned >= pp.amount && assignments.length === 1
        ? assignments[0].boxId
        : amountAssigned >= pp.amount && assignments.length > 1
          ? assignments[0].boxId // fully assigned across multiple boxes
          : null

      const firstSessionProductId = assignments.length > 0 ? assignments[0].sessionProductId : null
      const id = firstSessionProductId ?? `picklist-${pp.idpicklist_product ?? index}-${pp.idproduct}`

      return {
        id,
        productCode: pp.productcode,
        name: pp.name,
        amount: pp.amount,
        amountPicked: pp.amount_picked,
        weight: 0,
        imageUrl: null,
        location: '',
        assignedBoxId,
        amountAssigned,
        assignedBoxes: assignments,
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
        amount: sp.amount,
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

  // Suggested packagings based on picklist tags
  const suggestedPackagings = useMemo(() => {
    if (!picklist?.tags || picklist.tags.length === 0) return []
    const tagTitles = picklist.tags.map((t) => t.title)
    const tagMappings = getMappingsForTags(tagTitles)
    if (tagMappings.length === 0) return []

    const suggested: PicqerPackaging[] = []
    const seenIds = new Set<number>()
    for (const mapping of tagMappings) {
      if (seenIds.has(mapping.picqerPackagingId)) continue
      const pkg = activePackagings.find((p) => p.idpackaging === mapping.picqerPackagingId)
      if (pkg) {
        suggested.push(pkg)
        seenIds.add(mapping.picqerPackagingId)
      }
    }
    return suggested
  }, [picklist, getMappingsForTags, activePackagings])

  // IDs of suggested packagings (for filtering them from the full list)
  const suggestedPackagingIds = useMemo(
    () => new Set(suggestedPackagings.map((p) => p.idpackaging)),
    [suggestedPackagings]
  )

  // Auto-create boxes based on tag-packaging mappings (multi-tag: all matching tags → all matching boxes)
  useEffect(() => {
    if (autoBoxCreatedRef.current) return
    if (!session || !picklist) return
    if (session.boxes.length > 0) return
    if (packagingsLoading || mappingsLoading) return
    if (suggestedPackagings.length === 0) return

    autoBoxCreatedRef.current = true

    // Create all matching boxes sequentially to avoid race conditions
    const createBoxes = async () => {
      for (const pkg of suggestedPackagings) {
        await addBox(pkg.name, pkg.idpackaging, pkg.barcode ?? undefined)
      }
      setAutoBoxMessage(
        suggestedPackagings.length === 1
          ? `Doos automatisch aangemaakt: ${suggestedPackagings[0].name}`
          : `${suggestedPackagings.length} dozen automatisch aangemaakt`
      )
    }
    createBoxes()
  }, [session, picklist, suggestedPackagings, packagingsLoading, mappingsLoading, addBox])

  // Auto-dismiss auto-box message
  useEffect(() => {
    if (!autoBoxMessage) return
    const timer = setTimeout(() => setAutoBoxMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [autoBoxMessage])

  // Computed values
  const assignedProductsCount = productItems.filter((p) => p.amountAssigned >= p.amount).length
  const totalProductsCount = productItems.length

  // Toggle sidebar panel
  const togglePanel = useCallback((panel: string) => {
    setExpandedPanels((prev) => {
      const next = new Set(prev)
      if (next.has(panel)) {
        next.delete(panel)
      } else {
        next.add(panel)
      }
      return next
    })
  }, [])

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

    const targetBox = session?.boxes.find((b) => b.id === targetId)
    if (targetBox) {
      handleAssignProduct(productId, targetId)
    }
  }

  const handleAssignProduct = useCallback(
    async (productItemId: string, boxId: string, amount?: number) => {
      const productItem = productItems.find((p) => p.id === productItemId)
      if (!productItem || !picklist) return

      const picklistProduct = picklist.products.find(
        (pp) => pp.productcode === productItem.productCode && pp.name === productItem.name
      )
      if (!picklistProduct) return

      const remaining = productItem.amount - productItem.amountAssigned
      const assignAmount = amount ?? remaining

      if (assignAmount <= 0) return

      await assignProduct(boxId, {
        picqerProductId: picklistProduct.idproduct,
        productcode: picklistProduct.productcode,
        productName: picklistProduct.name,
        amount: assignAmount,
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

  // Shipping provider ID from picklist
  const shippingProviderId = picklist?.idshippingprovider_profile ?? null

  const handleShipAll = useCallback(
    (providerId: number) => {
      shipAllBoxes(providerId)
    },
    [shipAllBoxes]
  )

  const handleRetryBox = useCallback(
    (boxId: string) => {
      if (!shippingProviderId || !session) return
      const box = session.boxes.find((b) => b.id === boxId)
      if (!box) return
      shipBox(boxId, shippingProviderId, box.picqerPackagingId ?? undefined)
    },
    [shipBox, shippingProviderId, session]
  )

  // Multi-select handlers
  const unassignedProducts = useMemo(
    () => productItems.filter((p) => p.amountAssigned < p.amount),
    [productItems]
  )

  const handleToggleSelect = useCallback((productId: string) => {
    setSelectedProducts((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    const unassignedIds = unassignedProducts.map((p) => p.id)
    const allSelected = unassignedIds.every((id) => selectedProducts.has(id))
    if (allSelected) {
      setSelectedProducts(new Set())
    } else {
      setSelectedProducts(new Set(unassignedIds))
    }
  }, [unassignedProducts, selectedProducts])

  const handleBulkAssign = useCallback(
    async (boxId: string) => {
      const toAssign = productItems.filter(
        (p) => selectedProducts.has(p.id) && p.assignedBoxId === null
      )
      if (toAssign.length === 0) return

      setIsBulkAssigning(true)
      setShowBulkAssignMenu(false)
      for (const product of toAssign) {
        await handleAssignProduct(product.id, boxId)
      }
      setSelectedProducts(new Set())
      setIsBulkAssigning(false)
    },
    [productItems, selectedProducts, handleAssignProduct]
  )

  // Clear selection when products change (reassigned)
  useEffect(() => {
    setSelectedProducts((prev) => {
      const stillUnassigned = new Set(
        productItems.filter((p) => p.assignedBoxId === null).map((p) => p.id)
      )
      const filtered = new Set([...prev].filter((id) => stillUnassigned.has(id)))
      return filtered.size === prev.size ? prev : filtered
    })
  }, [productItems])

  const selectedCount = selectedProducts.size
  const allUnassignedSelected = unassignedProducts.length > 0 && unassignedProducts.every((p) => selectedProducts.has(p.id))

  // Barcode scan handler
  const handleBarcodeScan = useCallback(
    (barcode: string) => {
      // 1. Check against packagings first (smaller list)
      const matchedPackaging = activePackagings.find(
        (pkg) => pkg.barcode && pkg.barcode.toLowerCase() === barcode.toLowerCase()
      )
      if (matchedPackaging) {
        addBox(matchedPackaging.name, matchedPackaging.idpackaging, matchedPackaging.barcode ?? undefined)
        setScanFeedback({ message: `Doos aangemaakt: ${matchedPackaging.name}`, type: 'success' })
        return
      }

      // 2. Check against products (find one with remaining amount)
      const matchedProduct = productItems.find(
        (p) => p.productCode.toLowerCase() === barcode.toLowerCase() && (p.amount - p.amountAssigned) > 0
      )
      if (matchedProduct) {
        // Find first open box
        const openBox = session?.boxes.find((b) => !closedBoxes.has(b.id) && b.status !== 'shipped')
        if (!openBox) {
          setScanFeedback({ message: 'Maak eerst een doos aan', type: 'warning' })
          return
        }
        const remaining = matchedProduct.amount - matchedProduct.amountAssigned
        handleAssignProduct(matchedProduct.id, openBox.id, remaining)
        setHighlightProductId(matchedProduct.id)
        setScanFeedback({ message: `${matchedProduct.productCode} (${remaining}x) → Doos ${openBox.boxIndex + 1}`, type: 'success' })
        return
      }

      // 3. Check if product exists but is already fully assigned
      const alreadyAssigned = productItems.find(
        (p) => p.productCode.toLowerCase() === barcode.toLowerCase() && p.amountAssigned >= p.amount
      )
      if (alreadyAssigned) {
        setScanFeedback({ message: `${barcode} is al volledig toegewezen`, type: 'warning' })
        return
      }

      // 4. No match
      setScanFeedback({ message: `Barcode niet herkend: ${barcode}`, type: 'error' })
    },
    [activePackagings, productItems, session, closedBoxes, addBox, handleAssignProduct]
  )

  // Auto-dismiss scan feedback
  useEffect(() => {
    if (!scanFeedback) return
    const timer = setTimeout(() => setScanFeedback(null), 3000)
    return () => clearTimeout(timer)
  }, [scanFeedback])

  // Auto-dismiss product highlight
  useEffect(() => {
    if (!highlightProductId) return
    const timer = setTimeout(() => setHighlightProductId(null), 1500)
    return () => clearTimeout(timer)
  }, [highlightProductId])

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
      <BarcodeListener onScan={handleBarcodeScan} enabled={!showAddBoxModal && !showShipmentModal} />
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="bg-card border-b border-border px-3 py-2 lg:px-4 lg:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 lg:gap-3 min-w-0">
              {showLeaveConfirm ? (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-sm text-amber-800">
                    {isSaving
                      ? 'Even wachten...'
                      : 'Sessie verlaten? Je voortgang wordt bewaard.'}
                  </p>
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-600 flex-shrink-0" />
                  ) : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={onBack}
                        className="px-3 py-1.5 min-h-[44px] bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
                      >
                        Verlaat sessie
                      </button>
                      <button
                        onClick={() => setShowLeaveConfirm(false)}
                        className="px-3 py-1.5 min-h-[44px] border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                      >
                        Annuleer
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setShowLeaveConfirm(true)}
                    className="p-2 -ml-1 rounded-lg hover:bg-muted transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
                    title="Terug naar wachtrij"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base lg:text-lg font-semibold truncate">
                        {picklist?.picklistid ?? `Picklist #${session.picklistId}`}
                      </span>
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded flex-shrink-0">
                        {translateStatus(session.status)}
                      </span>
                      {isSaving && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Opslaan...
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 hidden sm:block">
                      {workerName}
                    </p>
                    {picklist?.tags && picklist.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {picklist.tags.map((tag) => (
                          <span
                            key={tag.idtag}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none"
                            style={{
                              backgroundColor: tag.color ? `${tag.color}20` : undefined,
                              color: tag.color || undefined,
                              border: tag.color ? `1px solid ${tag.color}40` : undefined,
                            }}
                          >
                            {tag.title}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
              {/* Scan feedback indicator */}
              {scanFeedback && (
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium animate-in fade-in duration-200 ${
                    scanFeedback.type === 'success'
                      ? 'bg-emerald-100 text-emerald-800'
                      : scanFeedback.type === 'warning'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                  }`}
                >
                  <ScanBarcode className="w-3.5 h-3.5" />
                  <span className="max-w-[200px] truncate">{scanFeedback.message}</span>
                </div>
              )}
              {/* Product count - hidden on small screens, shown in tab bar instead */}
              <div className="hidden lg:flex text-right text-sm text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Package className="w-4 h-4" />
                  <span>{assignedProductsCount} / {totalProductsCount} producten toegewezen</span>
                </div>
              </div>
              {/* Session info toggle - only on small screens */}
              <button
                onClick={() => setShowSessionInfo(!showSessionInfo)}
                className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                title="Sessie info"
              >
                <Info className="w-5 h-5 text-muted-foreground" />
              </button>
              {/* Ship All button */}
              {session.boxes.length > 0 && (
                <button
                  onClick={() => setShowShipmentModal(true)}
                  className="flex items-center gap-2 px-3 py-2 lg:px-4 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">Alles verzenden</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible session info panel - mobile/tablet only */}
        {showSessionInfo && (
          <div className="lg:hidden bg-muted/20 border-b border-border px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Medewerker</p>
                <p className="font-medium">{workerName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-medium">{translateStatus(session.status)}</p>
              </div>
              {picklist && (
                <div>
                  <p className="text-xs text-muted-foreground">Totaal producten</p>
                  <p>{picklist.totalproducts} ({picklist.totalpicked} gepickt)</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">Dozen</p>
                <p>{session.boxes.length}</p>
              </div>
            </div>
            {/* Delivery address (mobile) */}
            {order && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Bezorgadres</p>
                <p className="text-sm font-medium">{order.deliveryname}</p>
                {order.deliveryaddress && (
                  <p className="text-xs text-muted-foreground">{order.deliveryaddress}</p>
                )}
                {(order.deliveryzipcode || order.deliverycity) && (
                  <p className="text-xs text-muted-foreground">
                    {order.deliveryzipcode}{order.deliveryzipcode && order.deliverycity ? ' ' : ''}{order.deliverycity}
                  </p>
                )}
                {order.reference && (
                  <p className="text-xs text-muted-foreground mt-1">Ref: {order.reference}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Warning banners */}
        {warnings.length > 0 && (
          <div className="px-3 pt-2 lg:px-4 space-y-2">
            {warnings.map((warning, index) => (
              <div
                key={`${index}-${warning.slice(0, 20)}`}
                className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800"
              >
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                <span className="flex-1">{warning}</span>
                <button
                  onClick={() => dismissWarning(index)}
                  className="p-1 -mr-1 -mt-0.5 rounded hover:bg-amber-200/50 transition-colors flex-shrink-0"
                  title="Sluiten"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Auto-box creation notification */}
        {autoBoxMessage && (
          <div className="px-3 pt-2 lg:px-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
              <Tag className="w-4 h-4 flex-shrink-0 text-emerald-600" />
              <span className="flex-1">{autoBoxMessage}</span>
              <button
                onClick={() => setAutoBoxMessage(null)}
                className="p-1 -mr-1 rounded hover:bg-emerald-200/50 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Tab bar - mobile/tablet only (below lg breakpoint) */}
        <div className="lg:hidden border-b border-border bg-card">
          <div className="flex">
            <button
              onClick={() => setActiveTab('products')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] text-sm font-medium transition-colors relative ${
                activeTab === 'products'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Package className="w-4 h-4" />
              <span>Producten ({totalProductsCount})</span>
              {assignedProductsCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-green-100 text-green-800 rounded-full">
                  {assignedProductsCount}
                </span>
              )}
              {activeTab === 'products' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('boxes')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] text-sm font-medium transition-colors relative ${
                activeTab === 'boxes'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Box className="w-4 h-4" />
              <span>Dozen ({session.boxes.length})</span>
              {activeProduct && activeTab !== 'boxes' && (
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800 rounded-full animate-pulse">
                  Drop
                </span>
              )}
              {activeTab === 'boxes' && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          </div>
          {/* Compact progress bar + select controls on mobile */}
          <div className="px-4 pb-2 space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex-shrink-0">{assignedProductsCount}/{totalProductsCount} toegewezen</span>
              <div className="flex-1 bg-muted rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${totalProductsCount > 0 ? Math.round((assignedProductsCount / totalProductsCount) * 100) : 0}%` }}
                />
              </div>
            </div>
            {activeTab === 'products' && unassignedProducts.length > 0 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={handleSelectAll}
                  className="text-xs text-primary hover:underline"
                >
                  {allUnassignedSelected ? 'Deselecteren' : 'Alles selecteren'}
                </button>
                {selectedCount > 0 && (
                  <div className="relative">
                    <button
                      onClick={() => setShowBulkAssignMenu(!showBulkAssignMenu)}
                      disabled={isBulkAssigning}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {isBulkAssigning ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Box className="w-3 h-3" />
                      )}
                      {selectedCount} toewijzen
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {showBulkAssignMenu && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={() => setShowBulkAssignMenu(false)}
                        />
                        <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[220px]">
                          <div className="p-1">
                            <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                              Toewijzen aan doos
                            </p>
                            {boxRefs.filter((b) => !b.isClosed).map((box) => (
                              <button
                                key={box.id}
                                onClick={() => handleBulkAssign(box.id)}
                                className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left"
                              >
                                <Box className="w-4 h-4 text-muted-foreground" />
                                <span>Doos {box.index}: {box.name}</span>
                              </button>
                            ))}
                            {boxRefs.filter((b) => !b.isClosed).length === 0 && (
                              <p className="px-2 py-2 text-xs text-muted-foreground">
                                Geen open dozen beschikbaar
                              </p>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main content area */}
        <div className="flex-1 flex overflow-hidden">
          {/* Center area: columns + status bar + comments */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Columns */}
            <div className="flex-1 flex overflow-hidden">
              {/* Products column - full width on mobile when active, half on desktop */}
              <div
                className={`flex-col border-border lg:!flex lg:w-1/2 lg:border-r ${
                  activeTab === 'products' ? 'flex flex-1 lg:flex-none' : 'hidden'
                }`}
              >
                {/* Column header - desktop only (tabs serve as header on mobile) */}
                <div className="hidden lg:block px-4 py-3 border-b border-border bg-muted/30">
                  <div className="flex items-center justify-between">
                    <h2 className="font-semibold flex items-center gap-2">
                      <Package className="w-4 h-4" />
                      Producten ({totalProductsCount})
                    </h2>
                    {unassignedProducts.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSelectAll}
                          className="text-xs text-primary hover:underline"
                        >
                          {allUnassignedSelected ? 'Deselecteren' : 'Alles selecteren'}
                        </button>
                        {selectedCount > 0 && (
                          <div className="relative">
                            <button
                              onClick={() => setShowBulkAssignMenu(!showBulkAssignMenu)}
                              disabled={isBulkAssigning}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              {isBulkAssigning ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Box className="w-3 h-3" />
                              )}
                              {selectedCount} toewijzen
                              <ChevronDown className="w-3 h-3" />
                            </button>
                            {showBulkAssignMenu && (
                              <>
                                <div
                                  className="fixed inset-0 z-10"
                                  onClick={() => setShowBulkAssignMenu(false)}
                                />
                                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[220px]">
                                  <div className="p-1">
                                    <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                                      Toewijzen aan doos
                                    </p>
                                    {boxRefs.filter((b) => !b.isClosed).map((box) => (
                                      <button
                                        key={box.id}
                                        onClick={() => handleBulkAssign(box.id)}
                                        className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left"
                                      >
                                        <Box className="w-4 h-4 text-muted-foreground" />
                                        <span>Doos {box.index}: {box.name}</span>
                                      </button>
                                    ))}
                                    {boxRefs.filter((b) => !b.isClosed).length === 0 && (
                                      <p className="px-2 py-2 text-xs text-muted-foreground">
                                        Geen open dozen beschikbaar
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 lg:p-4 space-y-2">
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
                        onRemoveFromBox={(sessionProductId) => {
                          if (sessionProductId) {
                            handleRemoveProduct(sessionProductId)
                          } else if (product.assignedBoxId && session) {
                            // Fallback: remove first match
                            const box = session.boxes.find((b) => b.id === product.assignedBoxId)
                            const sessionProd = box?.products.find(
                              (sp) => sp.productcode === product.productCode && sp.productName === product.name
                            )
                            if (sessionProd) {
                              handleRemoveProduct(sessionProd.id)
                            }
                          }
                        }}
                        boxes={boxRefs}
                        onAssignToBox={(boxId, amount) => handleAssignProduct(product.id, boxId, amount)}
                        isSelected={selectedProducts.has(product.id)}
                        onSelectToggle={() => handleToggleSelect(product.id)}
                        isHighlighted={highlightProductId === product.id}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Boxes column - full width on mobile when active, half on desktop */}
              <div
                className={`flex-col lg:!flex lg:w-1/2 ${
                  activeTab === 'boxes' ? 'flex flex-1 lg:flex-none' : 'hidden'
                }`}
              >
                {/* Column header - desktop only */}
                <div className="hidden lg:block px-4 py-3 border-b border-border bg-muted/30">
                  <h2 className="font-semibold flex items-center gap-2">
                    <Box className="w-4 h-4" />
                    Dozen ({session.boxes.length})
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 lg:p-4 space-y-3">
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
                    className="w-full border-2 border-dashed border-border rounded-lg p-4 lg:p-6 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-colors group min-h-[64px]"
                  >
                    <div className="w-10 h-10 lg:w-12 lg:h-12 rounded-full bg-muted flex items-center justify-center group-hover:bg-primary/10">
                      <Plus className="w-5 h-5 lg:w-6 lg:h-6 text-muted-foreground group-hover:text-primary" />
                    </div>
                    <span className="font-medium text-muted-foreground group-hover:text-primary">
                      Doos toevoegen
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Comments section — full width below columns (desktop) */}
            <div className="hidden lg:block border-t border-border">
              <BottomComments
                comments={picklistComments}
                isLoading={isLoadingComments}
                onAddComment={addPicklistComment}
                onDeleteComment={deletePicklistComment}
                onRefresh={fetchComments}
                users={picqerUsers}
                currentUserName={workerName}
              />
            </div>
          </div>

          {/* Sidebar - 4 collapsible panels (desktop only) */}
          <div className="w-64 xl:w-72 border-l border-border flex-shrink-0 bg-muted/20 overflow-y-auto hidden lg:block">
            {/* Panel 1: Bezorging */}
            <SidebarPanel
              title="Bezorging"
              icon={<MapPin className="w-4 h-4" />}
              isExpanded={expandedPanels.has('delivery')}
              onToggle={() => togglePanel('delivery')}
            >
              {orderLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Laden...
                </div>
              ) : order ? (
                <div className="space-y-1.5 text-sm">
                  {order.deliveryname && (
                    <p className="font-medium">{order.deliveryname}</p>
                  )}
                  {order.deliverycontactname && order.deliverycontactname !== order.deliveryname && (
                    <p className="text-muted-foreground">{order.deliverycontactname}</p>
                  )}
                  {order.deliveryaddress && (
                    <p className="text-muted-foreground">{order.deliveryaddress}</p>
                  )}
                  {(order.deliveryzipcode || order.deliverycity) && (
                    <p className="text-muted-foreground">
                      {order.deliveryzipcode}{order.deliveryzipcode && order.deliverycity ? ' ' : ''}{order.deliverycity}
                    </p>
                  )}
                  {order.deliverycountry && (
                    <p className="text-muted-foreground">{order.deliverycountry}</p>
                  )}
                  {picklist?.idshippingprovider_profile && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground">Verzendprofiel</p>
                      <p className="text-xs font-medium">#{picklist.idshippingprovider_profile}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Geen bezorggegevens beschikbaar</p>
              )}
            </SidebarPanel>

            {/* Panel 2: Details */}
            <SidebarPanel
              title="Details"
              icon={<Tag className="w-4 h-4" />}
              isExpanded={expandedPanels.has('details')}
              onToggle={() => togglePanel('details')}
            >
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Medewerker</p>
                  <p className="font-medium">{workerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Picklist</p>
                  <p className="font-medium">{picklist?.picklistid ?? session.picklistId}</p>
                </div>
                {order && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Bestelling</p>
                      <p className="font-medium">{order.orderid}</p>
                    </div>
                    {order.reference && (
                      <div>
                        <p className="text-xs text-muted-foreground">Referentie</p>
                        <p className="font-medium">{order.reference}</p>
                      </div>
                    )}
                  </>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="font-medium">{translateStatus(session.status)}</p>
                </div>
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">Producten</p>
                    <p>{picklist.totalproducts} ({picklist.totalpicked} gepickt)</p>
                  </div>
                )}
                {picklist?.tags && picklist.tags.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {picklist.tags.map((tag) => (
                        <span
                          key={tag.idtag}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none"
                          style={{
                            backgroundColor: tag.color ? `${tag.color}20` : undefined,
                            color: tag.color || undefined,
                            border: tag.color ? `1px solid ${tag.color}40` : undefined,
                          }}
                        >
                          {tag.title}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
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
            </SidebarPanel>

            {/* Panel 3: Zendingen */}
            <SidebarPanel
              title="Zendingen"
              icon={<Truck className="w-4 h-4" />}
              isExpanded={expandedPanels.has('shipments')}
              onToggle={() => togglePanel('shipments')}
            >
              {session.boxes.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nog geen dozen aangemaakt</p>
              ) : (
                <div className="space-y-2">
                  {session.boxes.map((box) => {
                    const statusBadge = box.status === 'shipped'
                      ? 'bg-emerald-100 text-emerald-700'
                      : box.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground'
                    return (
                      <div key={box.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Doos {box.boxIndex + 1}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${statusBadge}`}>
                            {translateStatus(box.status)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {box.packagingName} · {box.products.length} product{box.products.length !== 1 ? 'en' : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </SidebarPanel>

            {/* Opmerkingen staan full-width in BottomComments onder de kolommen */}
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

          {/* Suggested packagings based on tags */}
          {suggestedPackagings.length > 0 && !boxSearchQuery.trim() && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" />
                Aanbevolen verpakking
              </h4>
              <div className="space-y-1">
                {suggestedPackagings.map((pkg) => (
                  <button
                    key={`suggested-${pkg.idpackaging}`}
                    onClick={() => handleAddBox(pkg)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
                  >
                    <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center flex-shrink-0">
                      <Box className="w-5 h-5 text-primary" />
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
                    <ChevronRight className="w-4 h-4 text-primary" />
                  </button>
                ))}
              </div>

              {/* Divider */}
              <div className="flex items-center gap-2 mt-4 mb-2">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground">Of kies handmatig</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </div>
          )}

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
                {filteredPackagings
                  .filter((pkg) => boxSearchQuery.trim() || !suggestedPackagingIds.has(pkg.idpackaging))
                  .map((pkg) => (
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
        onRetryBox={handleRetryBox}
        shippingProviderId={shippingProviderId}
      />
    </DndContext>
  )
}

// ── Sidebar Panel (collapsible) ──────────────────────────────────────────

function SidebarPanel({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: {
  title: string
  icon: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-muted/30 transition-colors text-left"
      >
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>
      {isExpanded && (
        <div className="px-4 pb-3">
          {children}
        </div>
      )}
    </div>
  )
}

// ── Bottom Comments (full-width, like BatchOverview CommentsCard) ─────────

function BottomComments({
  comments,
  isLoading,
  onAddComment,
  onDeleteComment,
  onRefresh,
  users,
  currentUserName,
}: {
  comments: PicklistComment[]
  isLoading: boolean
  onAddComment: (body: string) => Promise<{ success: boolean; error?: string }>
  onDeleteComment: (idcomment: number) => Promise<{ success: boolean; error?: string }>
  onRefresh: () => void
  users: { iduser: number; fullName: string }[]
  currentUserName: string
}) {
  const [newComment, setNewComment] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const trimmed = newComment.trim()
    if (!trimmed) return

    setIsSending(true)
    setSendError(null)
    try {
      const result = await onAddComment(trimmed)
      if (result.success) {
        setNewComment('')
      } else {
        setSendError(result.error || 'Kon opmerking niet versturen')
      }
    } finally {
      setIsSending(false)
    }
  }

  const handleReply = (authorName: string) => {
    setNewComment((prev) => {
      const prefix = `@${authorName} `
      return prev ? `${prev}${prefix}` : prefix
    })
    textareaRef.current?.focus()
  }

  const handleDelete = async (idcomment: number) => {
    setDeletingId(idcomment)
    try {
      const result = await onDeleteComment(idcomment)
      if (!result.success) {
        setSendError(result.error || 'Kon opmerking niet verwijderen')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const isOwnComment = (authorName: string) =>
    currentUserName && authorName.toLowerCase() === currentUserName.toLowerCase()

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Opmerkingen
          {comments.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">({comments.length})</span>
          )}
        </h3>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Existing comments */}
      {isLoading && comments.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Opmerkingen laden...
        </div>
      ) : comments.length > 0 ? (
        <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
          {comments.map((comment) => (
            <div key={comment.idcomment} className="group px-4 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{comment.authorName}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleReply(comment.authorName)}
                    className="px-2 py-0.5 text-xs border border-border rounded hover:bg-muted transition-colors"
                  >
                    Reageer
                  </button>
                  {isOwnComment(comment.authorName) && (
                    <button
                      onClick={() => handleDelete(comment.idcomment)}
                      disabled={deletingId === comment.idcomment}
                      className="px-2 py-0.5 text-xs border border-border rounded hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {deletingId === comment.idcomment ? 'Bezig...' : 'Verwijder'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{comment.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          Nog geen opmerkingen.
        </div>
      )}

      {/* New comment input */}
      <div className="border-t border-border px-4 py-3">
        {sendError && (
          <p className="text-xs text-destructive mb-2">{sendError}</p>
        )}
        <div className="flex items-end gap-2">
          <MentionTextarea
            ref={textareaRef}
            value={newComment}
            onChange={setNewComment}
            onKeyDown={handleKeyDown}
            placeholder="Schrijf een opmerking... (@mention)"
            disabled={isSending}
            users={users}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !newComment.trim()}
            className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
