'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
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
  ExternalLink,
  Sparkles,
  Check,
  Printer,
  Puzzle,
} from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import { usePackingSession } from '@/hooks/usePackingSession'
import { usePackingStation } from '@/hooks/usePackingStation'
import { useLocalPackagings } from '@/hooks/useLocalPackagings'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import { usePicklistComments, type PicklistComment } from '@/hooks/usePicklistComments'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import type { PicqerPicklistWithProducts, PicqerPicklistProduct, PicqerPackaging, PicqerOrder, PicqerOrderfield } from '@/lib/picqer/types'
import { ORDERFIELD_IDS } from '@/lib/picqer/types'
import { getTagPackagingFilter } from '@/lib/verpakking/tag-packaging-filter'
import BatchNavigationBar from './BatchNavigationBar'
import BarcodeListener from './BarcodeListener'
import ProductCard, { type ProductCardItem, type BoxRef, type ProductCustomFields } from './ProductCard'
import BoxCard, { type BoxCardItem, type BoxProductItem, type PackagingPartItem } from './BoxCard'
import ShipmentProgress from './ShipmentProgress'

// Engine advice response type
interface EngineAdviceBox {
  packaging_id: string
  packaging_name: string
  idpackaging: number
  products: { productcode: string; shipping_unit_name: string; quantity: number }[]
  box_cost?: number
  box_pick_cost?: number
  box_pack_cost?: number
  transport_cost?: number
  total_cost?: number
  carrier_code?: string
  weight_grams?: number
  weight_bracket?: string | null
}

interface AlternativePackaging {
  packaging_id: string
  name: string
  idpackaging: number
  box_cost?: number
  box_pick_cost?: number
  box_pack_cost?: number
  transport_cost?: number
  total_cost?: number
  carrier_code?: string
  is_recommended: boolean
  is_cheapest: boolean
}

interface EngineAdvice {
  id: string
  order_id: number
  confidence: 'full_match' | 'partial_match' | 'no_match'
  advice_boxes: EngineAdviceBox[]
  alternatives?: AlternativePackaging[]
  shipping_units_detected: { shipping_unit_id: string; shipping_unit_name: string; quantity: number }[]
  unclassified_products: string[]
  tags_written: string[]
  weight_exceeded?: boolean
  cost_data_available?: boolean
}

// Product group for rendering (composition groups + single products)
type ProductGroup =
  | { type: 'group'; parentName: string; parentProductCode: string; parentIdProduct: number; items: ProductCardItem[] }
  | { type: 'single'; item: ProductCardItem }

// Composition info for child products (maps child idproduct → parent info)
interface CompositionInfo {
  parentOrderProductId: number
  parentName: string
  parentProductCode: string
  parentIdProduct: number
  parentIsPackaging: boolean
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return '-'
  return `\u20AC${value.toFixed(2)}`
}

function getCountryName(code: string): string {
  const countries: Record<string, string> = {
    NL: 'Nederland', BE: 'Belgie', DE: 'Duitsland', FR: 'Frankrijk',
    AT: 'Oostenrijk', LU: 'Luxemburg', SE: 'Zweden', IT: 'Italie', ES: 'Spanje',
    DK: 'Denemarken', PL: 'Polen', CZ: 'Tsjechie', UK: 'Verenigd Koninkrijk', GB: 'Verenigd Koninkrijk',
  }
  return countries[code?.toUpperCase()] ?? code
}

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
  // Picqer picklist statuses
  new: 'Nieuw',
  paused: 'Gepauzeerd',
  snoozed: 'Gesnoozed',
  cancelled: 'Geannuleerd',
  // Picqer order statuses
  concept: 'Concept',
  expected: 'Verwacht',
  processing: 'In verwerking',
}

function translateStatus(status: string): string {
  return STATUS_TRANSLATIONS[status] ?? status
}

interface BatchContextProps {
  batchSessionId: string
  batchDisplayId: string
  picklists: import('@/types/verpakking').BatchPicklistItem[]
}

interface VerpakkingsClientProps {
  sessionId: string
  onBack: () => void
  workerName: string
  batchContext?: BatchContextProps
}

export default function VerpakkingsClient({ sessionId, onBack, workerName, batchContext }: VerpakkingsClientProps) {
  const router = useRouter()

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
    updateProductAmount,
    removeProduct,
    shipBox,
    shipAllBoxes,
    cancelBoxShipment,
    dismissWarning,
  } = usePackingSession(sessionId)

  // Batch navigation: derive next picklist for ShipmentProgress
  const nextPicklistInBatch = useMemo(() => {
    if (!batchContext) return null
    const currentIndex = batchContext.picklists.findIndex((pl) => pl.sessionId === sessionId)
    if (currentIndex === -1) return null
    for (let i = currentIndex + 1; i < batchContext.picklists.length; i++) {
      const pl = batchContext.picklists[i]
      if (pl.sessionStatus !== 'completed' && pl.status !== 'closed') return pl
    }
    for (let i = 0; i < currentIndex; i++) {
      const pl = batchContext.picklists[i]
      if (pl.sessionStatus !== 'completed' && pl.status !== 'closed') return pl
    }
    return null
  }, [batchContext, sessionId])

  const [isNavCreatingSession, setIsNavCreatingSession] = useState(false)

  const handleBatchNavigate = useCallback(async (picklist: import('@/types/verpakking').BatchPicklistItem) => {
    if (picklist.sessionId) {
      const batchIdParam = new URLSearchParams(window.location.search).get('batchId')
      const url = `/verpakkingsmodule/picklist/${picklist.sessionId}${batchIdParam ? `?batchId=${batchIdParam}` : ''}`
      router.push(url)
      return
    }

    // No session yet (dev mode) — create one on the fly
    setIsNavCreatingSession(true)
    try {
      const res = await fetch('/api/verpakking/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picklistId: picklist.idpicklist,
          assignedTo: session?.workerId || 0,
          assignedToName: session?.workerName || workerName,
          devMode: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sessie aanmaken mislukt')

      const batchIdParam = new URLSearchParams(window.location.search).get('batchId')
      router.push(`/verpakkingsmodule/picklist/${data.id}${batchIdParam ? `?batchId=${batchIdParam}` : ''}`)
    } catch (err) {
      console.error('Failed to create nav session:', err)
    } finally {
      setIsNavCreatingSession(false)
    }
  }, [router, workerName, session?.workerId, session?.workerName])

  // Packing station (for auto-print)
  const { selectedStation, stations, selectStation, clearStation, packingStationId } = usePackingStation()

  // Local packagings (for image URLs)
  const { packagings: localPackagings } = useLocalPackagings(true)

  // Build a lookup map: picqerPackagingId -> imageUrl
  const packagingImageMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const lp of localPackagings) {
      if (lp.imageUrl && lp.idpackaging !== 0) {
        map.set(lp.idpackaging, lp.imageUrl)
      }
    }
    return map
  }, [localPackagings])

  // Build a lookup: packaging barcode -> packaging info (for identifying packaging-as-product items)
  const packagingBarcodeMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; idpackaging: number; barcode: string }>()
    for (const lp of localPackagings) {
      if (lp.barcode && lp.active) {
        map.set(lp.barcode, { id: lp.id, name: lp.name, idpackaging: lp.idpackaging, barcode: lp.barcode })
      }
    }
    return map
  }, [localPackagings])

  // Picqer users for @ mentions
  const { users: picqerUsers } = usePicqerUsers()

  // Picklist data from Picqer
  const [picklist, setPicklist] = useState<PicqerPicklistWithProducts | null>(null)
  const [picklistLoading, setPicklistLoading] = useState(false)
  const [picklistError, setPicklistError] = useState<string | null>(null)

  // Order data from Picqer (delivery address etc.)
  const [order, setOrder] = useState<PicqerOrder | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)

  // Composition map: maps child idproduct → parent info (from order products)
  // Used to group products by set and filter packaging parts
  const compositionMap = useMemo(() => {
    const map = new Map<number, CompositionInfo>()
    if (!order?.products) return map

    // Find all parents (has_parts: true)
    const parents = new Map<number, typeof order.products[0]>()
    for (const p of order.products) {
      if (p.has_parts) {
        parents.set(p.idorder_product, p)
      }
    }

    // Map children to their parent
    for (const p of order.products) {
      if (p.partof_idorder_product) {
        const parent = parents.get(p.partof_idorder_product)
        if (parent) {
          map.set(p.idproduct, {
            parentOrderProductId: parent.idorder_product,
            parentName: parent.name,
            parentProductCode: parent.productcode,
            parentIdProduct: parent.idproduct,
            parentIsPackaging: packagingBarcodeMap.has(parent.productcode),
          })
        }
      }
    }

    return map
  }, [order, packagingBarcodeMap])

  // Set of parent idproducts (virtual sets that shouldn't appear as pickable products)
  const compositionParentIds = useMemo(() => {
    const ids = new Set<number>()
    for (const info of compositionMap.values()) {
      ids.add(info.parentIdProduct)
    }
    return ids
  }, [compositionMap])

  // Packagings from Picqer
  const [packagings, setPackagings] = useState<PicqerPackaging[]>([])
  const [packagingsLoading, setPackagingsLoading] = useState(false)

  // Product custom fields (from Supabase product_attributes)
  const [productCustomFields, setProductCustomFields] = useState<Map<number, ProductCustomFields>>(new Map())

  // Shipping profile name (resolved from idshippingprovider_profile)
  const [shippingProfileName, setShippingProfileName] = useState<string | null>(null)

  // Engine packaging advice
  const [engineAdvice, setEngineAdvice] = useState<EngineAdvice | null>(null)
  const [engineLoading, setEngineLoading] = useState(false)
  const engineCalledRef = useRef(false)
  const [adviceDetailsExpanded, setAdviceDetailsExpanded] = useState(false)


  // Picklist comments
  const picklistIdForComments = picklist?.idpicklist ?? null
  const {
    comments: picklistComments,
    isLoading: isLoadingComments,
    fetchComments,
    addComment: addPicklistComment,
    deleteComment: deletePicklistComment,
  } = usePicklistComments(picklistIdForComments)

  // API user name for comment ownership (falls back to workerName)
  const [apiUserName] = useState<string | null>(null)

  // Leave session confirmation
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)

  // Sidebar expanded panels
  const [expandedPanels, setExpandedPanels] = useState<Set<string>>(new Set(['delivery', 'details', 'shipments']))

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
  const [shipmentModalBoxId, setShipmentModalBoxId] = useState<string | null>(null)
  const [showStationPicker, setShowStationPicker] = useState(false)
  const [quantityPickerState, setQuantityPickerState] = useState<{
    productItemId: string
    boxId: string
    maxAmount: number
    productName: string
  } | null>(null)
  const [boxSearchQuery, setBoxSearchQuery] = useState('')
  const [showAllPackagings, setShowAllPackagings] = useState(false)
  const [closedBoxes, setClosedBoxes] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState<'products' | 'boxes'>('products')
  const [showSessionInfo, setShowSessionInfo] = useState(false)

  // Outcome feedback state
  const [outcomeFeedback, setOutcomeFeedback] = useState<{
    outcome: string
    deviationType: string
  } | null>(null)

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

  // Resolve shipping profile name when picklist loads
  useEffect(() => {
    if (!picklist?.idshippingprovider_profile || !picklist?.idpicklist) return

    let cancelled = false
    fetch(`/api/picqer/shipping-methods?picklistId=${picklist.idpicklist}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled || !data?.methods) return
        const match = data.methods.find(
          (m: { idshippingprovider_profile: number; name: string }) =>
            m.idshippingprovider_profile === picklist.idshippingprovider_profile
        )
        if (match) setShippingProfileName(match.name)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [picklist?.idpicklist, picklist?.idshippingprovider_profile])

  // Fetch product custom fields when picklist loads
  useEffect(() => {
    if (!picklist?.products?.length) return

    const ids = picklist.products.map((p) => p.idproduct).join(',')
    fetch(`/api/verpakking/product-attributes?ids=${ids}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!data?.attributes) return
        const map = new Map<number, ProductCustomFields>()
        for (const [id, attrs] of Object.entries(data.attributes)) {
          map.set(parseInt(id, 10), attrs as ProductCustomFields)
        }
        setProductCustomFields(map)
      })
      .catch(() => {/* non-blocking */})
  }, [picklist])

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

  // Call packaging engine when picklist products and order data are available
  useEffect(() => {
    if (engineCalledRef.current) return
    if (!picklist?.products || picklist.products.length === 0) return
    if (!picklist.idorder) return
    if (!order?.deliverycountry) return  // Wait for order data to load

    engineCalledRef.current = true
    setEngineLoading(true)

    const products = picklist.products.map((pp: PicqerPicklistProduct) => ({
      picqer_product_id: pp.idproduct,
      productcode: pp.productcode,
      quantity: pp.amount,
    }))

    fetch('/api/verpakking/engine/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: picklist.idorder,
        picklistId: picklist.idpicklist,
        products,
        shippingProviderProfileId: picklist.idshippingprovider_profile ?? undefined,
        countryCode: order.deliverycountry,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('Engine advies ophalen mislukt')
        return res.json()
      })
      .then((data) => {
        if (data.advice) {
          setEngineAdvice(data.advice)
          console.log('[VerpakkingsClient] Engine advice:', data.advice.confidence, data.advice.advice_boxes?.length, 'boxes')
        }
      })
      .catch((err) => {
        console.error('[VerpakkingsClient] Engine advice error:', err)
        // Silently fall back to tag mappings — don't show error to user
      })
      .finally(() => {
        setEngineLoading(false)
      })
  }, [picklist, order])

  // Auto-pick packaging products and create boxes for them
  const autoPickCalledRef = useRef(false)
  useEffect(() => {
    if (autoPickCalledRef.current) return
    if (!picklist?.products || picklist.products.length === 0) return
    if (!session || !sessionId) return
    if (packagingBarcodeMap.size === 0) return

    // Find packaging products in this picklist
    const packagingProducts = picklist.products.filter(pp => packagingBarcodeMap.has(pp.productcode))
    if (packagingProducts.length === 0) return

    // Check if boxes already exist for these packagings (session was reloaded)
    const existingPackagingBarcodes = new Set(
      session.boxes.map(b => b.packagingBarcode).filter(Boolean)
    )
    const needsProcessing = packagingProducts.filter(
      pp => !existingPackagingBarcodes.has(pp.productcode)
    )

    // Also check if products are already fully picked (session resumed after auto-pick)
    const allAlreadyPicked = packagingProducts.every(pp => pp.amount_picked >= pp.amount)
    if (needsProcessing.length === 0 && allAlreadyPicked) return

    autoPickCalledRef.current = true

    // 1. Auto-pick in Picqer (non-blocking)
    const unpickedCodes = packagingProducts
      .filter(pp => pp.amount_picked < pp.amount)
      .map(pp => pp.productcode)

    if (unpickedCodes.length > 0) {
      fetch(`/api/verpakking/sessions/${sessionId}/auto-pick-packaging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packagingProductCodes: unpickedCodes }),
      }).catch(err => console.error('[VerpakkingsClient] Auto-pick failed:', err))
    }

    // 2. Auto-create boxes for packaging products that don't have a box yet
    for (const pp of needsProcessing) {
      const pkg = packagingBarcodeMap.get(pp.productcode)
      if (!pkg) continue
      addBox(pkg.name, pkg.idpackaging, pkg.barcode)
    }
  }, [picklist, session, sessionId, packagingBarcodeMap, addBox])

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

  // Detect outcome feedback from shipProgress
  useEffect(() => {
    if (!shipProgress || shipProgress.size === 0) return

    // Find any box with outcome data
    for (const progress of shipProgress.values()) {
      if (progress.outcome && progress.deviationType && !outcomeFeedback) {
        setOutcomeFeedback({
          outcome: progress.outcome,
          deviationType: progress.deviationType,
        })
        break
      }
    }
  }, [shipProgress, outcomeFeedback])

  // Auto-dismiss outcome feedback after 15 seconds
  useEffect(() => {
    if (!outcomeFeedback) return
    const timer = setTimeout(() => setOutcomeFeedback(null), 15000)
    return () => clearTimeout(timer)
  }, [outcomeFeedback])

  // Map picklist products to ProductCardItems (supports split assignments across boxes)
  // Products with multiple pick_locations are split into separate lines per location.
  const productItems: ProductCardItem[] = useMemo(() => {
    if (!picklist?.products) return []

    // Filter out:
    // 1. Packaging products (boxes that appear as line items)
    // 2. Composition parents (virtual sets - not physically pickable)
    // 3. Packaging composition parts (belong to the box, not the product list)
    const realProducts = picklist.products.filter(pp => {
      if (packagingBarcodeMap.has(pp.productcode)) return false
      if (compositionParentIds.has(pp.idproduct)) return false
      const compInfo = compositionMap.get(pp.idproduct)
      if (compInfo?.parentIsPackaging) return false
      return true
    })

    // Helper: collect box assignments for a product
    const getAssignments = (pp: PicqerPicklistProduct) => {
      const assignments: { boxId: string; boxName: string; boxIndex: number; amount: number; sessionProductId: string }[] = []
      if (session) {
        for (let i = 0; i < session.boxes.length; i++) {
          const box = session.boxes[i]
          const matches = box.products.filter(
            (sp) => sp.picqerProductId === pp.idproduct && sp.productcode === pp.productcode
          )
          for (const match of matches) {
            assignments.push({
              boxId: box.id,
              boxName: box.packagingName,
              boxIndex: i + 1,
              amount: match.amount,
              sessionProductId: match.id,
            })
          }
        }
      }
      return assignments
    }

    // Helper: build a ProductCardItem from product + location info
    const buildItem = (
      pp: PicqerPicklistProduct,
      index: number,
      amount: number,
      amountPicked: number,
      location: string,
      idSuffix: string,
      idpicklist_product_location?: number,
    ): ProductCardItem => {
      const assignments = getAssignments(pp)
      const amountAssigned = assignments.reduce((sum, a) => sum + a.amount, 0)
      const assignedBoxId = amountAssigned >= amount && assignments.length >= 1
        ? assignments[0].boxId
        : null

      const firstSessionProductId = assignments.length > 0 ? assignments[0].sessionProductId : null
      const id = firstSessionProductId ?? `picklist-${idSuffix}-${pp.idproduct}`

      const compInfo = compositionMap.get(pp.idproduct)

      return {
        id,
        productCode: pp.productcode,
        name: pp.name,
        amount,
        amountPicked,
        weight: 0,
        imageUrl: pp.image ?? null,
        location,
        assignedBoxId,
        amountAssigned,
        assignedBoxes: assignments,
        customFields: productCustomFields.get(pp.idproduct),
        idpicklist_product: pp.idpicklist_product,
        idpicklist_product_location: idpicklist_product_location,
        idproduct: pp.idproduct,
        compositionParent: compInfo && !compInfo.parentIsPackaging ? {
          name: compInfo.parentName,
          productCode: compInfo.parentProductCode,
          idproduct: compInfo.parentIdProduct,
        } : undefined,
      }
    }

    const items: ProductCardItem[] = []

    for (let index = 0; index < realProducts.length; index++) {
      const pp = realProducts[index]
      const locations = pp.pick_locations?.filter(l => l.amount > 0) ?? []

      if (locations.length > 1) {
        // Split into separate lines per location
        for (const loc of locations) {
          items.push(buildItem(
            pp,
            index,
            loc.amount,
            loc.amount_picked,
            loc.name,
            `${pp.idpicklist_product ?? index}-loc-${loc.idlocation ?? loc.name}`,
            loc.idpicklist_product_location,
          ))
        }
      } else {
        // Single location or no locations — one line
        const location = locations.length === 1
          ? locations[0].name
          : pp.stocklocation || ''
        items.push(buildItem(
          pp,
          index,
          pp.amount,
          pp.amount_picked,
          location,
          `${pp.idpicklist_product ?? index}`,
          locations[0]?.idpicklist_product_location,
        ))
      }
    }

    return items
  }, [picklist, session, productCustomFields, packagingBarcodeMap, compositionMap, compositionParentIds])

  // Group products by composition parent for rendering
  const productGroups: ProductGroup[] = useMemo(() => {
    const groups: ProductGroup[] = []
    const grouped = new Map<number, ProductCardItem[]>()
    const singles: ProductCardItem[] = []

    for (const item of productItems) {
      if (item.compositionParent) {
        const key = item.compositionParent.idproduct
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(item)
      } else {
        singles.push(item)
      }
    }

    // Add groups first, then singles
    for (const [, items] of grouped) {
      const parent = items[0].compositionParent!
      groups.push({
        type: 'group',
        parentName: parent.name,
        parentProductCode: parent.productCode,
        parentIdProduct: parent.idproduct,
        items,
      })
    }

    for (const item of singles) {
      groups.push({ type: 'single', item })
    }

    return groups
  }, [productItems])

  // Collapsed state for composition groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set())
  const toggleGroup = useCallback((parentIdProduct: number) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(parentIdProduct)) next.delete(parentIdProduct)
      else next.add(parentIdProduct)
      return next
    })
  }, [])

  // Build BoxRef array for the ProductCard dropdown
  const boxRefs: BoxRef[] = useMemo(() => {
    if (!session) return []
    return session.boxes.map((box, i) => ({
      id: box.id,
      name: box.packagingName,
      index: i + 1,
      productCount: box.products.length,
      isClosed: closedBoxes.has(box.id) || box.status === 'closed',
    }))
  }, [session, closedBoxes])

  // Build BoxCardItem array for BoxCard component
  const boxItems: BoxCardItem[] = useMemo(() => {
    if (!session) return []
    return session.boxes.map((box) => {
      // Find packaging parts for this box (composition children of the packaging product)
      let packagingParts: PackagingPartItem[] | undefined
      if (box.packagingBarcode) {
        const parts: PackagingPartItem[] = []
        for (const [childIdProduct, info] of compositionMap) {
          if (info.parentIsPackaging && info.parentProductCode === box.packagingBarcode) {
            // Find this child in the picklist to get picked status
            const picklistProd = picklist?.products.find(pp => pp.idproduct === childIdProduct)
            if (picklistProd) {
              parts.push({
                productCode: picklistProd.productcode,
                name: picklistProd.name,
                amount: picklistProd.amount,
                picked: picklistProd.amount_picked >= picklistProd.amount,
              })
            }
          }
        }
        if (parts.length > 0) packagingParts = parts
      }

      return {
        id: box.id,
        packagingName: box.packagingName,
        packagingImageUrl: (box.picqerPackagingId && packagingImageMap.get(box.picqerPackagingId)) || null,
        picqerPackagingId: box.picqerPackagingId,
        products: box.products.map((sp): BoxProductItem => {
          // Calculate maxAmount: current amount in this box + unassigned for this product
          const picklistProduct = picklist?.products.find(
            (pp) => pp.idproduct === sp.picqerProductId && pp.productcode === sp.productcode
          )
          const totalOnPicklist = picklistProduct?.amount ?? sp.amount
          // Sum what's assigned across ALL boxes for this product
          const totalAssigned = session.boxes.reduce((sum, b) => {
            return sum + b.products
              .filter((p) => p.picqerProductId === sp.picqerProductId && p.productcode === sp.productcode)
              .reduce((s, p) => s + p.amount, 0)
          }, 0)
          const unassigned = totalOnPicklist - totalAssigned
          const maxAmount = sp.amount + unassigned

          return {
            id: sp.id,
            productCode: sp.productcode,
            name: sp.productName,
            amount: sp.amount,
            maxAmount,
            weight: (sp.weightPerUnit ?? 0) * sp.amount,
            imageUrl: picklistProduct?.image ?? null,
          }
        }),
        packagingParts,
        isClosed: closedBoxes.has(box.id) || box.status === 'closed',
        shipmentCreated: box.status === 'shipped' || box.status === 'label_fetched',
        trackingCode: box.trackingCode,
        trackingUrl: box.trackingUrl,
        labelUrl: box.labelUrl,
        shippedAt: box.shippedAt,
      }
    })
  }, [session, closedBoxes, picklist, packagingImageMap, compositionMap])

  // Filtered packagings for the add box modal (Picqer + local-only)
  const activePackagings = useMemo(() => {
    const picqerActive = packagings.filter((p) => p.active)
    const picqerIds = new Set(picqerActive.map((p) => p.idpackaging))

    // Include local-only packagings that don't exist in Picqer
    const localOnly: PicqerPackaging[] = localPackagings
      .filter((lp) => !picqerIds.has(lp.idpackaging))
      .map((lp) => ({
        idpackaging: lp.idpackaging,
        name: lp.name,
        barcode: lp.barcode,
        length: lp.length,
        width: lp.width,
        height: lp.height,
        use_in_auto_advice: lp.useInAutoAdvice,
        active: lp.active,
      }))

    return [...picqerActive, ...localOnly]
  }, [packagings, localPackagings])

  // Tag-based packaging filter: restrict available packagings when order has a matching tag
  const tagFilter = useMemo(() => {
    if (!picklist?.tags || picklist.tags.length === 0) return null
    return getTagPackagingFilter(picklist.tags.map((t) => t.idtag))
  }, [picklist])

  const tagFilteredPackagings = useMemo(() => {
    if (!tagFilter) return activePackagings
    const allowedIds = new Set(tagFilter.packagingIds)
    return activePackagings.filter((p) => allowedIds.has(p.idpackaging))
  }, [tagFilter, activePackagings])

  const filteredPackagings = useMemo(() => {
    const base = tagFilteredPackagings
    if (!boxSearchQuery.trim()) return base
    const query = boxSearchQuery.toLowerCase()
    return base.filter(
      (pkg) =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.barcode?.toLowerCase().includes(query)
    )
  }, [boxSearchQuery, tagFilteredPackagings])

  // Suggested packagings based on picklist tags matched via packagings.picqer_tag_name
  const suggestedPackagings = useMemo(() => {
    if (!picklist?.tags || picklist.tags.length === 0) return []
    const tagTitles = new Set(picklist.tags.map((t) => t.title.toLowerCase()))

    // Build a map of tag name → packaging idpackaging from localPackagings
    const tagToPackagingId = new Map<string, number>()
    for (const lp of localPackagings) {
      if (lp.picqerTagName) {
        tagToPackagingId.set(lp.picqerTagName.toLowerCase(), lp.idpackaging)
      }
    }

    const suggested: PicqerPackaging[] = []
    const seenIds = new Set<number>()
    for (const tagTitle of tagTitles) {
      const idpackaging = tagToPackagingId.get(tagTitle)
      if (!idpackaging || seenIds.has(idpackaging)) continue
      const pkg = tagFilteredPackagings.find((p) => p.idpackaging === idpackaging)
      if (pkg) {
        suggested.push(pkg)
        seenIds.add(idpackaging)
      }
    }
    return suggested
  }, [picklist, localPackagings, tagFilteredPackagings])

  // IDs of suggested packagings (for filtering them from the full list)
  const suggestedPackagingIds = useMemo(
    () => new Set(suggestedPackagings.map((p) => p.idpackaging)),
    [suggestedPackagings]
  )

  // IDs of engine-advised packagings (for filtering them from the full list)
  const engineAdviceIds = useMemo(
    () => new Set(
      engineAdvice && engineAdvice.confidence !== 'no_match'
        ? engineAdvice.advice_boxes.map((ab) => ab.idpackaging)
        : []
    ),
    [engineAdvice]
  )

  // Whether there are any suggestions to show (engine or tags)
  const hasSuggestions = (engineAdvice && engineAdvice.confidence !== 'no_match' && engineAdvice.advice_boxes.length > 0) || suggestedPackagings.length > 0

  // Auto-create boxes: prefer engine advice, fall back to tag mappings
  useEffect(() => {
    if (autoBoxCreatedRef.current) return
    if (!session || !picklist) return
    if (session.boxes.length > 0) return
    if (packagingsLoading) return
    // Wait for engine to finish before deciding
    if (engineLoading) return

    // Determine which boxes to auto-create
    const engineBoxes = engineAdvice?.advice_boxes ?? []
    const useEngine = engineAdvice && engineAdvice.confidence !== 'no_match' && engineBoxes.length > 0

    if (useEngine) {
      autoBoxCreatedRef.current = true

      const createBoxes = async () => {
        for (const adviceBox of engineBoxes) {
          const pkg = activePackagings.find((p) => p.idpackaging === adviceBox.idpackaging)
          const boxId = await addBox(
            adviceBox.packaging_name,
            adviceBox.idpackaging,
            pkg?.barcode ?? undefined,
            {
              packagingAdviceId: engineAdvice!.id,
              suggestedPackagingId: adviceBox.idpackaging,
              suggestedPackagingName: adviceBox.packaging_name,
            }
          )

          // Auto-assign producten voor deze doos
          // Skip synthetic entries like "(composition parts)" — those don't exist on the picklist
          if (boxId && adviceBox.products.length > 0) {
            const assignableProducts = adviceBox.products.filter(
              (ap) => !ap.productcode.startsWith('(')
            )
            for (const adviceProduct of assignableProducts) {
              const picklistProduct = picklist!.products.find(
                (pp: PicqerPicklistProduct) => pp.productcode === adviceProduct.productcode
              )
              if (picklistProduct) {
                await assignProduct(boxId, {
                  picqerProductId: picklistProduct.idproduct,
                  productcode: adviceProduct.productcode,
                  productName: picklistProduct.name,
                  amount: adviceProduct.quantity,
                })
              } else {
                console.warn(`[VerpakkingsClient] Auto-assign: product ${adviceProduct.productcode} niet gevonden op picklist`)
              }
            }
          }
        }
        const label = engineAdvice!.confidence === 'full_match' ? 'Advies' : 'Gedeeltelijk advies'
        const autoAssigned = engineBoxes.every(b => b.products.length > 0)
          ? ' — producten automatisch toegewezen'
          : ''
        setAutoBoxMessage(
          engineBoxes.length === 1
            ? `${label}: ${engineBoxes[0].packaging_name}${autoAssigned}`
            : `${label}: ${engineBoxes.length} dozen aangemaakt${autoAssigned}`
        )
      }
      createBoxes()
    } else if (suggestedPackagings.length > 0) {
      // Fall back to tag-packaging mappings
      autoBoxCreatedRef.current = true

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
    }
  }, [session, picklist, suggestedPackagings, packagingsLoading, engineAdvice, engineLoading, activePackagings, addBox, assignProduct])

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
      if (remaining <= 0) return

      // If amount not specified and multiple units remain, show quantity picker
      if (amount === undefined && remaining > 1) {
        setQuantityPickerState({
          productItemId,
          boxId,
          maxAmount: remaining,
          productName: productItem.name,
        })
        return
      }

      const assignAmount = amount ?? remaining

      if (assignAmount <= 0) return

      // Check if this product already exists in the target box — merge instead of creating duplicate
      const existingInBox = session?.boxes
        .find((b) => b.id === boxId)
        ?.products.find(
          (sp) => sp.picqerProductId === picklistProduct.idproduct && sp.productcode === picklistProduct.productcode
        )

      if (existingInBox) {
        await updateProductAmount(existingInBox.id, existingInBox.amount + assignAmount)
      } else {
        await assignProduct(boxId, {
          picqerProductId: picklistProduct.idproduct,
          productcode: picklistProduct.productcode,
          productName: picklistProduct.name,
          amount: assignAmount,
        })
      }
    },
    [productItems, picklist, session, assignProduct, updateProductAmount]
  )

  const handleQuantitySelect = useCallback(
    async (amount: number) => {
      if (!quantityPickerState) return
      const { productItemId, boxId } = quantityPickerState
      setQuantityPickerState(null)
      await handleAssignProduct(productItemId, boxId, amount)
    },
    [quantityPickerState, handleAssignProduct]
  )

  const handleUpdateProductAmount = useCallback(
    async (sessionProductId: string, newAmount: number) => {
      await updateProductAmount(sessionProductId, newAmount)
    },
    [updateProductAmount]
  )

  const handleRemoveProduct = useCallback(
    async (sessionProductId: string) => {
      await removeProduct(sessionProductId)
    },
    [removeProduct]
  )

  const handleAddBox = useCallback(
    async (packaging: PicqerPackaging) => {
      // If engine advice exists, pass it as context so we can detect overrides.
      // Find the matching advice box for this packaging (not always [0])
      // so was_override is only true when the worker genuinely picks something different.
      let adviceMeta: { packagingAdviceId: string; suggestedPackagingId: number; suggestedPackagingName: string } | undefined
      if (engineAdvice && engineAdvice.confidence !== 'no_match' && engineAdvice.advice_boxes.length > 0) {
        const matchingAdviceBox = engineAdvice.advice_boxes.find(
          (ab) => ab.idpackaging === packaging.idpackaging
        )
        adviceMeta = {
          packagingAdviceId: engineAdvice.id,
          suggestedPackagingId: matchingAdviceBox?.idpackaging ?? engineAdvice.advice_boxes[0].idpackaging,
          suggestedPackagingName: matchingAdviceBox?.packaging_name ?? engineAdvice.advice_boxes[0].packaging_name,
        }
      }

      await addBox(packaging.name, packaging.idpackaging, packaging.barcode ?? undefined, adviceMeta)
      setShowAddBoxModal(false)
      setBoxSearchQuery('')
      setShowAllPackagings(false)
    },
    [addBox, engineAdvice]
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

  // Calculate weights per box (sum of product weights)
  const boxWeights = useMemo(() => {
    if (!session) return new Map<string, number>()
    const weights = new Map<string, number>()
    for (const box of session.boxes) {
      const totalWeight = box.products.reduce(
        (sum, p) => sum + (p.weightPerUnit ?? 0) * p.amount,
        0
      )
      if (totalWeight > 0) {
        weights.set(box.id, totalWeight)
      }
    }
    return weights
  }, [session])

  const handleShipAll = useCallback(
    (providerId: number, weights?: Map<string, number>, _packagingId?: number | null) => {
      shipAllBoxes(providerId, weights, packingStationId)
    },
    [shipAllBoxes, packingStationId]
  )

  const handleCancelShipment = useCallback(
    async (boxId: string) => {
      const result = await cancelBoxShipment(boxId)
      if (result.success) {
        // Remove from closedBoxes so the box becomes editable (closed state, not locked)
        setClosedBoxes((prev) => {
          const next = new Set(prev)
          next.delete(boxId)
          return next
        })
        setScanFeedback({ message: 'Zending geannuleerd', type: 'success' })
      } else if (result.error) {
        setScanFeedback({ message: `Annuleren mislukt: ${result.error}`, type: 'error' })
      }
    },
    [cancelBoxShipment]
  )

  const handleRetryBox = useCallback(
    (boxId: string, providerId: number) => {
      if (!session) return
      const box = session.boxes.find((b) => b.id === boxId)
      if (!box) return
      shipBox(boxId, providerId, box.picqerPackagingId ?? undefined, boxWeights.get(boxId), packingStationId)
    },
    [shipBox, session, boxWeights]
  )

  // Assign all unassigned products to a specific box
  const handleAssignAllToBox = useCallback(
    async (boxId: string) => {
      const toAssign = productItems.filter((p) => p.amountAssigned < p.amount)
      if (toAssign.length === 0) return

      for (const product of toAssign) {
        const remaining = product.amount - product.amountAssigned
        await handleAssignProduct(product.id, boxId, remaining)
      }
    },
    [productItems, handleAssignProduct]
  )

  // Multi-select handlers
  const unassignedProducts = useMemo(
    () => productItems.filter((p) => p.amountAssigned < p.amount),
    [productItems]
  )

  // Total unassigned units (not product lines)
  // Group by idproduct to avoid double-counting assignments when products span multiple pick locations
  const unassignedUnitCount = useMemo(() => {
    const byProduct = new Map<string, { totalAmount: number; amountAssigned: number }>()
    for (const p of productItems) {
      const key = `${p.idproduct ?? 0}-${p.productCode}`
      const existing = byProduct.get(key)
      if (existing) {
        existing.totalAmount += p.amount
        // amountAssigned is the same for all location lines of the same product, don't re-add
      } else {
        byProduct.set(key, { totalAmount: p.amount, amountAssigned: p.amountAssigned })
      }
    }
    let total = 0
    for (const { totalAmount, amountAssigned } of byProduct.values()) {
      total += Math.max(0, totalAmount - amountAssigned)
    }
    return total
  }, [productItems])

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
        const remaining = product.amount - product.amountAssigned
        await handleAssignProduct(product.id, boxId, remaining)
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
        let adviceMeta: { packagingAdviceId: string; suggestedPackagingId: number; suggestedPackagingName: string } | undefined
        if (engineAdvice && engineAdvice.confidence !== 'no_match' && engineAdvice.advice_boxes.length > 0) {
          const matchingAdviceBox = engineAdvice.advice_boxes.find(
            (ab) => ab.idpackaging === matchedPackaging.idpackaging
          )
          adviceMeta = {
            packagingAdviceId: engineAdvice.id,
            suggestedPackagingId: matchingAdviceBox?.idpackaging ?? engineAdvice.advice_boxes[0].idpackaging,
            suggestedPackagingName: matchingAdviceBox?.packaging_name ?? engineAdvice.advice_boxes[0].packaging_name,
          }
        }
        addBox(matchedPackaging.name, matchedPackaging.idpackaging, matchedPackaging.barcode ?? undefined, adviceMeta)
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
        const openBoxDisplayIndex = (session?.boxes.findIndex((b) => b.id === openBox.id) ?? 0) + 1
        setScanFeedback({ message: `${matchedProduct.productCode} (${remaining}x) → Doos ${openBoxDisplayIndex}`, type: 'success' })
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
    [activePackagings, productItems, session, closedBoxes, addBox, handleAssignProduct, engineAdvice]
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
        {/* Batch navigation bar */}
        {batchContext && batchContext.picklists.length > 1 && (
          <BatchNavigationBar
            batchDisplayId={batchContext.batchDisplayId}
            picklists={batchContext.picklists}
            currentSessionId={sessionId}
            onNavigate={handleBatchNavigate}
            onBatchClick={onBack}
            isNavigating={isNavCreatingSession}
          />
        )}
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
                  {/* Hide back button when BatchNavigationBar provides one */}
                  {!(batchContext && batchContext.picklists.length > 1) && (
                    <button
                      onClick={() => setShowLeaveConfirm(true)}
                      className="p-2 -ml-1 rounded-lg hover:bg-muted transition-colors flex-shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center border border-border"
                      title="Terug naar wachtrij"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
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
                    {order ? (
                      <div className="text-sm text-muted-foreground mt-0.5 hidden sm:flex sm:items-center sm:gap-2">
                        <span className="font-medium text-foreground">{order.deliveryname}</span>
                        {order.reference && <span>Ref: {order.reference}</span>}
                        <span>{workerName}</span>
                        <button
                          onClick={() => setShowStationPicker(true)}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none border transition-colors ${
                            selectedStation
                              ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                              : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                          }`}
                        >
                          <Printer className="w-3 h-3" />
                          {selectedStation ? selectedStation.name : 'Geen werkstation'}
                        </button>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground mt-0.5 hidden sm:flex sm:items-center sm:gap-2">
                        <span>{workerName}</span>
                        <button
                          onClick={() => setShowStationPicker(true)}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-none border transition-colors ${
                            selectedStation
                              ? 'border-green-300 bg-green-50 text-green-800 hover:bg-green-100'
                              : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                          }`}
                        >
                          <Printer className="w-3 h-3" />
                          {selectedStation ? selectedStation.name : 'Geen werkstation'}
                        </button>
                      </div>
                    )}
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

        {/* Engine packaging advice banner */}
        {engineAdvice && (
          <div className="px-3 pt-2 lg:px-4">
            <button
              onClick={() => setAdviceDetailsExpanded(!adviceDetailsExpanded)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                engineAdvice.confidence === 'full_match'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                  : engineAdvice.confidence === 'partial_match'
                    ? 'bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100'
                    : 'bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Sparkles className={`w-4 h-4 flex-shrink-0 ${
                engineAdvice.confidence === 'full_match' ? 'text-emerald-600'
                  : engineAdvice.confidence === 'partial_match' ? 'text-blue-600'
                    : 'text-amber-600'
              }`} />
              <span className="flex-1">
                {engineAdvice.confidence === 'full_match' && (
                  <>
                    Advies: {engineAdvice.advice_boxes.map((b) => b.packaging_name).join(' + ')}
                    {engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                      <span className="ml-1 font-medium">
                        ({formatCost(engineAdvice.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))} totaal)
                      </span>
                    )}
                  </>
                )}
                {engineAdvice.confidence === 'partial_match' && (
                  <>
                    Gedeeltelijk advies: {engineAdvice.advice_boxes.map((b) => b.packaging_name).join(' + ')}
                    {engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                      <span className="ml-1 font-medium">
                        ({formatCost(engineAdvice.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))} totaal)
                      </span>
                    )}
                  </>
                )}
                {engineAdvice.confidence === 'no_match' && (
                  <>Geen verpakkingsadvies beschikbaar</>
                )}
                {engineAdvice.unclassified_products.length > 0 && engineAdvice.confidence !== 'no_match' && (
                  <span className="text-xs ml-1 opacity-75">
                    ({engineAdvice.unclassified_products.length} product{engineAdvice.unclassified_products.length !== 1 ? 'en' : ''} niet geclassificeerd)
                  </span>
                )}
                {engineAdvice.weight_exceeded && (
                  <span className="text-xs ml-1 text-amber-700 font-medium">
                    — Let op: gewicht overschrijdt maximum
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${adviceDetailsExpanded ? 'rotate-180' : ''} ${
                engineAdvice.confidence === 'full_match' ? 'text-emerald-500'
                  : engineAdvice.confidence === 'partial_match' ? 'text-blue-500'
                    : 'text-amber-500'
              }`} />
            </button>
            {adviceDetailsExpanded && (
              <div className={`mt-1 rounded-lg text-xs overflow-hidden border ${
                engineAdvice.confidence === 'full_match'
                  ? 'border-emerald-200'
                  : engineAdvice.confidence === 'partial_match'
                    ? 'border-blue-200'
                    : 'border-amber-200'
              }`}>
                {/* Context row */}
                <div className={`px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 ${
                  engineAdvice.confidence === 'full_match' ? 'bg-emerald-50/50 text-emerald-700'
                    : engineAdvice.confidence === 'partial_match' ? 'bg-blue-50/50 text-blue-700'
                      : 'bg-amber-50/50 text-amber-700'
                }`}>
                  {order?.deliverycountry && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {getCountryName(order.deliverycountry)}
                    </span>
                  )}
                  {engineAdvice.shipping_units_detected.length > 0 && (
                    <span>
                      {engineAdvice.shipping_units_detected.map((su) =>
                        `${su.quantity}x ${su.shipping_unit_name}`
                      ).join(', ')}
                    </span>
                  )}
                </div>

                {/* Warnings */}
                {engineAdvice.unclassified_products.length > 0 && (
                  <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Niet geclassificeerd: {engineAdvice.unclassified_products.join(', ')}
                  </div>
                )}
                {engineAdvice.confidence === 'no_match' && engineAdvice.shipping_units_detected.length > 0 && (
                  <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Geen verpakking past bij deze verzendeenheden. Compartment rules ontbreken.
                  </div>
                )}
                {engineAdvice.cost_data_available === false && (
                  <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Kostdata niet beschikbaar — advies gebaseerd op specificiteit.
                  </div>
                )}

                {/* Cost breakdown per box */}
                {engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                  <div className="border-t border-inherit">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="text-left py-1.5 px-3 font-medium">Advies</th>
                          <th className="text-right py-1.5 px-2 font-medium">Materiaal</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pick</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pack</th>
                          <th className="text-right py-1.5 px-2 font-medium">Transport</th>
                          <th className="text-right py-1.5 px-3 font-medium">Totaal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engineAdvice.advice_boxes.map((box, idx) => (
                          box.total_cost !== undefined ? (
                            <tr key={idx} className="border-t border-inherit">
                              <td className="py-1.5 px-3">
                                <div className="font-medium">{box.packaging_name}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {box.products.map(p => `${p.quantity}x ${p.shipping_unit_name}`).join(', ')}
                                  {box.carrier_code && <span className="ml-1">— {box.carrier_code}{box.weight_bracket ? ` (${box.weight_bracket})` : ''}</span>}
                                </div>
                              </td>
                              <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(box.box_cost)}</td>
                              <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(box.box_pick_cost)}</td>
                              <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(box.box_pack_cost)}</td>
                              <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(box.transport_cost)}</td>
                              <td className="text-right py-1.5 px-3 tabular-nums font-semibold">{formatCost(box.total_cost)}</td>
                            </tr>
                          ) : null
                        ))}
                        {engineAdvice.advice_boxes.length > 1 && (
                          <tr className="border-t-2 border-inherit font-semibold">
                            <td className="py-1.5 px-3">Totaal ({engineAdvice.advice_boxes.length} dozen)</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(engineAdvice.advice_boxes.reduce((s, b) => s + (b.box_cost ?? 0), 0))}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(engineAdvice.advice_boxes.reduce((s, b) => s + (b.box_pick_cost ?? 0), 0))}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(engineAdvice.advice_boxes.reduce((s, b) => s + (b.box_pack_cost ?? 0), 0))}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(engineAdvice.advice_boxes.reduce((s, b) => s + (b.transport_cost ?? 0), 0))}</td>
                            <td className="text-right py-1.5 px-3 tabular-nums">{formatCost(engineAdvice.advice_boxes.reduce((s, b) => s + (b.total_cost ?? 0), 0))}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Alternatives comparison */}
                {engineAdvice.alternatives && engineAdvice.alternatives.length > 1 && engineAdvice.cost_data_available !== false && (
                  <div className="border-t border-inherit">
                    <div className="px-3 py-1.5 bg-muted/20 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Alle passende verpakkingen
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/10 text-muted-foreground">
                          <th className="text-left py-1.5 px-3 font-medium">Verpakking</th>
                          <th className="text-right py-1.5 px-2 font-medium">Materiaal</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pick</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pack</th>
                          <th className="text-right py-1.5 px-2 font-medium">Transport</th>
                          <th className="text-left py-1.5 px-2 font-medium">Carrier</th>
                          <th className="text-right py-1.5 px-3 font-medium">Totaal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engineAdvice.alternatives.map((alt) => (
                          <tr key={alt.packaging_id} className={`border-t border-inherit ${alt.is_recommended ? 'bg-emerald-50/30' : ''}`}>
                            <td className="py-1.5 px-3">
                              <span className={alt.is_recommended ? 'font-semibold' : ''}>{alt.name}</span>
                              {alt.is_recommended && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700">Aanbevolen</span>
                              )}
                              {alt.is_cheapest && !alt.is_recommended && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">Goedkoopst</span>
                              )}
                            </td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(alt.box_cost)}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(alt.box_pick_cost)}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(alt.box_pack_cost)}</td>
                            <td className="text-right py-1.5 px-2 tabular-nums">{formatCost(alt.transport_cost)}</td>
                            <td className="text-left py-1.5 px-2 text-muted-foreground">{alt.carrier_code || '—'}</td>
                            <td className="text-right py-1.5 px-3 tabular-nums font-semibold">{formatCost(alt.total_cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {engineLoading && (
          <div className="px-3 pt-2 lg:px-4">
            <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span>Verpakkingsadvies berekenen...</span>
            </div>
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

        {/* Outcome feedback banner (shown when session completes) */}
        {outcomeFeedback && engineAdvice && (
          <div className="px-3 pt-2 lg:px-4">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
              outcomeFeedback.outcome === 'followed'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : outcomeFeedback.outcome === 'modified'
                ? 'bg-blue-50 border-blue-200 text-blue-800'
                : outcomeFeedback.outcome === 'ignored'
                ? 'bg-amber-50 border-amber-200 text-amber-800'
                : 'bg-gray-50 border-gray-200 text-gray-600'
            }`}>
              <div className="flex-shrink-0">
                {outcomeFeedback.outcome === 'followed' ? (
                  <Check className="w-4 h-4" />
                ) : outcomeFeedback.outcome === 'modified' ? (
                  <Info className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
              </div>
              <span className="flex-1 font-medium">
                {outcomeFeedback.outcome === 'followed' ? 'Engine-advies volledig gevolgd'
                  : outcomeFeedback.outcome === 'modified' ? (
                    outcomeFeedback.deviationType === 'extra_boxes' ? 'Engine-advies aangepast — extra dozen toegevoegd' :
                    outcomeFeedback.deviationType === 'fewer_boxes' ? 'Engine-advies aangepast — minder dozen gebruikt' :
                    outcomeFeedback.deviationType === 'different_packaging' ? 'Engine-advies aangepast — andere verpakking gekozen' :
                    'Engine-advies aangepast'
                  )
                  : outcomeFeedback.outcome === 'ignored' ? 'Engine-advies niet gevolgd — andere verpakking gebruikt'
                  : 'Sessie voltooid'}
              </span>
              <button
                onClick={() => setOutcomeFeedback(null)}
                className={`p-1 -mr-1 rounded transition-colors flex-shrink-0 ${
                  outcomeFeedback.outcome === 'followed'
                    ? 'hover:bg-emerald-200/50'
                    : outcomeFeedback.outcome === 'modified'
                    ? 'hover:bg-blue-200/50'
                    : outcomeFeedback.outcome === 'ignored'
                    ? 'hover:bg-amber-200/50'
                    : 'hover:bg-gray-200/50'
                }`}
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
                    productGroups.map((group) => {
                      const renderProductCard = (product: ProductCardItem) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          onRemoveFromBox={(sessionProductId) => {
                            if (sessionProductId) {
                              handleRemoveProduct(sessionProductId)
                            } else if (product.assignedBoxId && session) {
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
                      )

                      if (group.type === 'single') {
                        return renderProductCard(group.item)
                      }

                      const isCollapsed = collapsedGroups.has(group.parentIdProduct)
                      const allAssigned = group.items.every(p => p.amountAssigned >= p.amount)

                      return (
                        <div key={`group-${group.parentIdProduct}`} className="space-y-1">
                          <button
                            onClick={() => toggleGroup(group.parentIdProduct)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                              allAssigned
                                ? 'bg-green-50 text-green-700 border border-green-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            <Puzzle className="w-4 h-4 flex-shrink-0" />
                            <span className="flex-1 text-left truncate">{group.parentName}</span>
                            {allAssigned && <Check className="w-4 h-4 flex-shrink-0" />}
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 flex-shrink-0" />
                            )}
                          </button>
                          {!isCollapsed && (
                            <div className="pl-3 border-l-2 border-amber-200 space-y-2 ml-2">
                              {group.items.map(renderProductCard)}
                            </div>
                          )}
                        </div>
                      )
                    })
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
                  {boxItems.map((box, i) => {
                    return (
                      <BoxCard
                        key={box.id}
                        box={box}
                        index={i + 1}
                        onRemoveProduct={(productId) => handleRemoveProduct(productId)}
                        onUpdateProductAmount={(productId, newAmount) => handleUpdateProductAmount(productId, newAmount)}
                        onCloseBox={() => handleCloseBox(box.id)}
                        onReopenBox={() => handleReopenBox(box.id)}
                        onRemoveBox={() => handleRemoveBox(box.id)}
                        onCreateShipment={() => { setShipmentModalBoxId(box.id); setShowShipmentModal(true) }}
                        onCancelShipment={() => handleCancelShipment(box.id)}
                        onAssignAllProducts={() => handleAssignAllToBox(box.id)}
                        unassignedProductCount={unassignedUnitCount}
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
                currentUserName={apiUserName ?? workerName}
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
                      <p className="text-xs font-medium">{shippingProfileName ?? `#${picklist.idshippingprovider_profile}`}</p>
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
                {order && (
                  <div>
                    <p className="text-xs text-muted-foreground">Order status</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                      order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      order.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(order.status)}
                    </span>
                  </div>
                )}
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">Picklist status</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      picklist.status === 'closed' ? 'bg-emerald-100 text-emerald-800' :
                      picklist.status === 'new' ? 'bg-yellow-100 text-yellow-800' :
                      picklist.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      picklist.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(picklist.status)}
                    </span>
                  </div>
                )}
                {order?.orderfields && (() => {
                  const leverdag = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.LEVERDAG)
                  return leverdag?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">Leverdag</p>
                      <p className="font-medium">{leverdag.value}</p>
                    </div>
                  ) : null
                })()}
                {order?.orderfields && (() => {
                  const retailer = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.RETAILER_NAME)
                  return retailer?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">Retailer</p>
                      <p className="font-medium">{retailer.value}</p>
                    </div>
                  ) : null
                })()}
                <div>
                  <p className="text-xs text-muted-foreground">Sessie status</p>
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
                  {session.boxes.map((box, i) => {
                    const statusBadge = box.status === 'shipped'
                      ? 'bg-emerald-100 text-emerald-700'
                      : box.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground'
                    return (
                      <div key={box.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">Doos {i + 1}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${statusBadge}`}>
                            {translateStatus(box.status)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {box.packagingName} · {box.products.length} product{box.products.length !== 1 ? 'en' : ''}
                        </p>
                        {box.trackingCode && (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {box.trackingUrl ? (
                              <a
                                href={box.trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline"
                              >
                                {box.trackingCode}
                              </a>
                            ) : (
                              box.trackingCode
                            )}
                          </p>
                        )}
                        {box.labelUrl && (
                          <a
                            href={box.labelUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                          >
                            Label openen
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {box.shippedAt && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Verzonden {new Date(box.shippedAt).toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          </p>
                        )}
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
          setShowAllPackagings(false)
        }}
        title="Doos toevoegen"
        className="max-w-5xl max-h-[90vh] flex flex-col"
      >
        <div className="flex flex-col overflow-hidden">
          {/* Sticky search input */}
          <div className="p-4 pb-0">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Zoek verpakking..."
                value={boxSearchQuery}
                onChange={(e) => {
                  setBoxSearchQuery(e.target.value)
                  if (e.target.value.trim()) {
                    setShowAllPackagings(true)
                  } else {
                    setShowAllPackagings(false)
                  }
                }}
                className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
            </div>
          </div>

          {/* Scrollable content */}
          <div className="overflow-y-auto px-4 pb-4">
            {/* Engine-advised packagings */}
            {engineAdvice && engineAdvice.confidence !== 'no_match' && engineAdvice.advice_boxes.length > 0 && !boxSearchQuery.trim() && (
              <div className="mb-6">
                <h4 className="text-xs font-medium text-emerald-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Engine advies
                  {engineAdvice.advice_boxes.length > 1 && (
                    <span className="text-emerald-600 normal-case">— {engineAdvice.advice_boxes.length} dozen aanbevolen</span>
                  )}
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {engineAdvice.advice_boxes.map((adviceBox, idx) => {
                    const pkg = activePackagings.find((p) => p.idpackaging === adviceBox.idpackaging)
                    if (!pkg) return null
                    return (
                      <button
                        key={`engine-${adviceBox.idpackaging}-${idx}`}
                        onClick={() => handleAddBox(pkg)}
                        className="flex flex-col items-center p-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 active:bg-emerald-200 transition-colors text-center min-h-[140px]"
                      >
                        {engineAdvice.advice_boxes.length > 1 && (
                          <span className="text-[10px] font-medium text-emerald-600 mb-1">Doos {idx + 1} van {engineAdvice.advice_boxes.length}</span>
                        )}
                        <div className="w-16 h-16 bg-emerald-100 rounded-lg flex items-center justify-center mb-2">
                          {packagingImageMap.get(adviceBox.idpackaging) ? (
                            <img
                              src={packagingImageMap.get(adviceBox.idpackaging)}
                              alt={adviceBox.packaging_name}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          ) : (
                            <Sparkles className="w-7 h-7 text-emerald-600" />
                          )}
                        </div>
                        <p className="font-medium text-sm leading-tight line-clamp-2">{adviceBox.packaging_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                          {adviceBox.products.map((p) => `${p.quantity}x ${p.shipping_unit_name}`).join(', ')}
                        </p>
                        {adviceBox.total_cost !== undefined && (
                          <p className="text-xs text-emerald-700 font-medium mt-1">
                            {formatCost(adviceBox.total_cost)}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Suggested packagings based on tags */}
            {suggestedPackagings.length > 0 && !boxSearchQuery.trim() && (
              <div className="mb-6">
                <h4 className="text-xs font-medium text-primary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" />
                  Tag-suggesties
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  {suggestedPackagings.map((pkg) => (
                    <button
                      key={`suggested-${pkg.idpackaging}`}
                      onClick={() => handleAddBox(pkg)}
                      className="flex flex-col items-center p-3 rounded-lg border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 active:bg-primary/20 transition-colors text-center min-h-[140px]"
                    >
                      <div className="w-16 h-16 rounded-lg flex items-center justify-center mb-2">
                        {packagingImageMap.get(pkg.idpackaging) ? (
                          <img
                            src={packagingImageMap.get(pkg.idpackaging)}
                            alt={pkg.name}
                            className="w-16 h-16 rounded-lg object-cover"
                          />
                        ) : (
                          <Box className="w-7 h-7 text-primary" />
                        )}
                      </div>
                      <p className="font-medium text-sm leading-tight line-clamp-2">{pkg.name}</p>
                      {pkg.barcode && (
                        <p className="text-[11px] text-muted-foreground font-mono mt-1">{pkg.barcode}</p>
                      )}
                      {(pkg.length || pkg.width || pkg.height) && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {pkg.length ?? '?'}×{pkg.width ?? '?'}×{pkg.height ?? '?'} cm
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* All packagings — collapsible */}
            <div>
              {packagingsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                  <span className="ml-2 text-sm text-muted-foreground">Verpakkingen laden...</span>
                </div>
              ) : boxSearchQuery.trim() ? (
                /* When searching: always show results in grid, no collapsible */
                <>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                    Resultaten ({filteredPackagings.length})
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filteredPackagings.map((pkg) => (
                      <button
                        key={pkg.idpackaging}
                        onClick={() => handleAddBox(pkg)}
                        className="flex flex-col items-center p-3 rounded-lg border border-border hover:bg-muted active:bg-muted/80 transition-colors text-center min-h-[140px]"
                      >
                        <div className="w-16 h-16 rounded-lg flex items-center justify-center mb-2">
                          {packagingImageMap.get(pkg.idpackaging) ? (
                            <img
                              src={packagingImageMap.get(pkg.idpackaging)}
                              alt={pkg.name}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          ) : (
                            <Box className="w-7 h-7 text-muted-foreground" />
                          )}
                        </div>
                        <p className="font-medium text-sm leading-tight line-clamp-2">{pkg.name}</p>
                        {pkg.barcode && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-1">{pkg.barcode}</p>
                        )}
                        {(pkg.length || pkg.width || pkg.height) && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {pkg.length ?? '?'}×{pkg.width ?? '?'}×{pkg.height ?? '?'} cm
                          </p>
                        )}
                        {(!pkg.idpackaging || pkg.idpackaging < 0) && (
                          <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" />
                            Geen Picqer ID
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                  {filteredPackagings.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Geen verpakkingen gevonden
                    </p>
                  )}
                </>
              ) : (
                /* Not searching: collapsible section (auto-expand when no suggestions) */
                <>
                  {hasSuggestions ? (
                    <button
                      onClick={() => setShowAllPackagings(!showAllPackagings)}
                      className="w-full flex items-center gap-2 py-2 text-left hover:bg-muted/50 rounded-lg transition-colors px-1"
                    >
                      <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showAllPackagings ? 'rotate-180' : '-rotate-90'}`} />
                      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        {tagFilter
                          ? `${tagFilter.label} verpakkingen (${tagFilteredPackagings.length})`
                          : `Alle verpakkingen (${activePackagings.length})`}
                      </h4>
                    </button>
                  ) : (
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      {tagFilter
                        ? `${tagFilter.label} verpakkingen (${tagFilteredPackagings.length})`
                        : `Alle verpakkingen (${activePackagings.length})`}
                    </h4>
                  )}
                  {(showAllPackagings || !hasSuggestions) && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mt-3">
                      {filteredPackagings
                        .filter((pkg) => !suggestedPackagingIds.has(pkg.idpackaging) && !engineAdviceIds.has(pkg.idpackaging))
                        .map((pkg) => (
                        <button
                          key={pkg.idpackaging}
                          onClick={() => handleAddBox(pkg)}
                          className="flex flex-col items-center p-3 rounded-lg border border-border hover:bg-muted active:bg-muted/80 transition-colors text-center min-h-[140px]"
                        >
                          <div className="w-16 h-16 rounded-lg flex items-center justify-center mb-2">
                            {packagingImageMap.get(pkg.idpackaging) ? (
                              <img
                                src={packagingImageMap.get(pkg.idpackaging)}
                                alt={pkg.name}
                                className="w-16 h-16 rounded-lg object-cover"
                              />
                            ) : (
                              <Box className="w-7 h-7 text-muted-foreground" />
                            )}
                          </div>
                          <p className="font-medium text-sm leading-tight line-clamp-2">{pkg.name}</p>
                          {pkg.barcode && (
                            <p className="text-[11px] text-muted-foreground font-mono mt-1">{pkg.barcode}</p>
                          )}
                          {(pkg.length || pkg.width || pkg.height) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {pkg.length ?? '?'}×{pkg.width ?? '?'}×{pkg.height ?? '?'} cm
                            </p>
                          )}
                          {(!pkg.idpackaging || pkg.idpackaging < 0) && (
                            <p className="text-[10px] text-amber-600 flex items-center gap-1 mt-1">
                              <AlertTriangle className="w-3 h-3" />
                              Geen Picqer ID
                            </p>
                          )}
                        </button>
                      ))}
                      {filteredPackagings.filter((pkg) => !suggestedPackagingIds.has(pkg.idpackaging) && !engineAdviceIds.has(pkg.idpackaging)).length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4 col-span-full">
                          Geen verpakkingen gevonden
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Station Picker Modal */}
      <Dialog
        open={showStationPicker}
        onClose={() => setShowStationPicker(false)}
        title="Werkstation"
        className="max-w-md"
      >
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-4">
            Kies een werkstation. Labels worden automatisch op de gekoppelde printer geprint.
          </p>
          <div className="space-y-2">
            <button
              onClick={() => {
                clearStation()
                setShowStationPicker(false)
              }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                !selectedStation
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/50 hover:bg-muted/50'
              }`}
            >
              <X className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-sm font-medium">Geen</p>
                <p className="text-xs text-muted-foreground">Labels openen in browser</p>
              </div>
              {!selectedStation && <Check className="w-4 h-4 text-primary ml-auto flex-shrink-0" />}
            </button>
            {stations.map((station) => {
              const isSelected = selectedStation?.id === station.id
              return (
                <button
                  key={station.id}
                  onClick={() => {
                    selectStation(station)
                    setShowStationPicker(false)
                  }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <Printer className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{station.name}</p>
                    {station.printnode_printer_name && (
                      <p className="text-xs text-muted-foreground truncate">{station.printnode_printer_name}</p>
                    )}
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      </Dialog>

      {/* Shipment Progress Modal */}
      <ShipmentProgress
        boxes={session.boxes.filter((b) => b.status === 'closed' || b.status === 'shipped')}
        shipProgress={shipProgress}
        isOpen={showShipmentModal}
        onClose={() => { setShowShipmentModal(false); setShipmentModalBoxId(null) }}
        onShipAll={handleShipAll}
        onRetryBox={handleRetryBox}
        picklistId={session.picklistId}
        defaultShippingProviderId={shippingProviderId}
        boxWeights={boxWeights}
        onNextPicklist={nextPicklistInBatch ? () => handleBatchNavigate(nextPicklistInBatch) : undefined}
        hasNextPicklist={!!nextPicklistInBatch}
        picqerPackagings={packagings.map(p => ({ idpackaging: p.idpackaging, name: p.name }))}
        defaultWeight={picklist?.weight ?? undefined}
        hasPackingStation={!!packingStationId}
        activeBoxId={shipmentModalBoxId}
      />

      {/* Quantity picker modal */}
      {quantityPickerState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setQuantityPickerState(null)}>
          <div className="bg-card rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">Hoeveel stuks?</h3>
            <p className="text-sm text-muted-foreground mb-4 truncate">{quantityPickerState.productName}</p>
            <div className="grid grid-cols-3 gap-3">
              {(quantityPickerState.maxAmount > 12
                ? [1, 2, 3, 5, 10, quantityPickerState.maxAmount].filter((v, i, a) => a.indexOf(v) === i)
                : Array.from({ length: quantityPickerState.maxAmount }, (_, i) => i + 1)
              ).map((num) => (
                <button
                  key={num}
                  onClick={() => handleQuantitySelect(num)}
                  className={`py-4 min-h-[60px] rounded-xl text-xl font-bold transition-colors ${
                    num === quantityPickerState.maxAmount
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted hover:bg-muted/80 text-foreground'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
            <button
              onClick={() => setQuantityPickerState(null)}
              className="w-full mt-4 py-3 min-h-[48px] text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}
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
