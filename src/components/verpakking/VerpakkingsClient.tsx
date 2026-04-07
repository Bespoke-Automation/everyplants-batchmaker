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
  CheckCircle2,
  Printer,
  Puzzle,
  Pencil,
  Save,
  XCircle,
} from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import { usePackingSession } from '@/hooks/usePackingSession'
import { usePackingStation, type PrinterStatus } from '@/hooks/usePackingStation'

const STATUS_CONFIG: Record<PrinterStatus, { dot: string; text: string; labelNl: string; labelEn: string }> = {
  online:       { dot: 'bg-emerald-500', text: 'text-emerald-600', labelNl: 'Online', labelEn: 'Online' },
  offline:      { dot: 'bg-red-500',     text: 'text-red-500',     labelNl: 'Offline', labelEn: 'Offline' },
  disconnected: { dot: 'bg-amber-500',   text: 'text-amber-600',   labelNl: 'Niet verbonden', labelEn: 'Not connected' },
  unknown:      { dot: 'bg-gray-400',    text: 'text-gray-400',    labelNl: 'Onbekend', labelEn: 'Unknown' },
}
import { useLocalPackagings } from '@/hooks/useLocalPackagings'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import { usePicklistComments, type PicklistComment } from '@/hooks/usePicklistComments'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import type { PicqerPicklistWithProducts, PicqerPicklistProduct, PicqerPackaging, PicqerOrder, PicqerOrderfield } from '@/lib/picqer/types'
import { ORDERFIELD_IDS } from '@/lib/picqer/types'
import { getTagPackagingFilter } from '@/lib/verpakking/tag-packaging-filter'
import { sortPicklistsByProduct } from '@/lib/verpakking/picklist-sort'
import BatchNavigationBar from './BatchNavigationBar'
import BarcodeListener from './BarcodeListener'
import ProductCard, { type ProductCardItem, type BoxRef, type ProductCustomFields } from './ProductCard'
import BoxCard, { type BoxCardItem, type BoxProduct } from './BoxCard'
import ShipmentProgress from './ShipmentProgress'
import CompletedView from './CompletedView'
import { useTranslation } from '@/i18n/LanguageContext'

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

function getCountryName(code: string, countryDict?: Record<string, string>): string {
  if (countryDict) {
    const key = code?.toUpperCase()
    if (key && countryDict[key]) return countryDict[key]
  }
  return code
}

// Map API status keys → dictionary keys in status section
const STATUS_KEY_MAP: Record<string, string> = {
  claimed: 'claimed',
  assigned: 'assigned',
  packing: 'packing',
  shipping: 'shipping',
  completed: 'completed',
  failed: 'failed',
  pending: 'pending',
  open: 'open',
  closed: 'closed',
  shipment_created: 'shipmentCreated',
  label_fetched: 'labelFetched',
  shipped: 'shipped',
  error: 'error',
  new: 'new',
  paused: 'paused',
  cancelled: 'cancelled',
  processing: 'processing',
}

function translateStatus(status: string, statusDict?: Record<string, string>): string {
  if (!statusDict) return status
  const key = STATUS_KEY_MAP[status]
  if (key && statusDict[key]) return statusDict[key]
  return status
}

interface BatchContextProduct {
  productcode: string
  picklistAllocations: { idpicklist: number; amount: number }[]
}

interface BatchContextProps {
  batchSessionId: string
  batchDisplayId: string
  picklists: import('@/types/verpakking').BatchPicklistItem[]
  products?: BatchContextProduct[]
}

interface VerpakkingsClientProps {
  sessionId: string
  onBack: () => void
  workerName: string
  batchContext?: BatchContextProps
}

export default function VerpakkingsClient({ sessionId, onBack, workerName, batchContext }: VerpakkingsClientProps) {
  const router = useRouter()
  const { t, language } = useTranslation()

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
    completeSession,
    dismissWarning,
  } = usePackingSession(sessionId)

  // Batch navigation: computed after localPackagings hook below

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
      if (!res.ok) throw new Error(data.error || t.packing.createSessionFailed)

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

  // Packaging productcodes set (used to filter box products from sort)
  const packagingProductcodes = useMemo(() => {
    const set = new Set<string>()
    for (const lp of localPackagings) {
      if (lp.barcode) set.add(lp.barcode)
    }
    return set
  }, [localPackagings])

  const sortedBatchPicklists = useMemo(() => {
    if (!batchContext) return []
    return sortPicklistsByProduct(batchContext.products, batchContext.picklists, packagingProductcodes)
  }, [batchContext, packagingProductcodes])

  const nextPicklistInBatch = useMemo(() => {
    if (!batchContext || sortedBatchPicklists.length === 0) return null
    const currentPicklistId = session?.picklistId
    if (!currentPicklistId) return null
    const currentIndex = sortedBatchPicklists.findIndex((pl) => pl.idpicklist === currentPicklistId)
    if (currentIndex === -1) {
      return sortedBatchPicklists.find((pl) => pl.status !== 'closed') ?? null
    }
    for (let i = currentIndex + 1; i < sortedBatchPicklists.length; i++) {
      if (sortedBatchPicklists[i].status !== 'closed') return sortedBatchPicklists[i]
    }
    for (let i = 0; i < currentIndex; i++) {
      if (sortedBatchPicklists[i].status !== 'closed') return sortedBatchPicklists[i]
    }
    return null
  }, [batchContext, sortedBatchPicklists, session?.picklistId])

  const isBatchCompleted = useMemo(() => {
    if (!batchContext || batchContext.picklists.length === 0) return false
    return batchContext.picklists.every((pl) => pl.status === 'closed')
  }, [batchContext])

  const handleExtraShipment = useCallback(() => {
    setExtraShipmentMode(true)
    setShowAddBoxModal(true)
  }, [])

  // Build a lookup: packaging barcode -> packaging info (for identifying packaging-as-product items)
  const packagingBarcodeMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; idpackaging: number; barcode: string }>()
    for (const lp of localPackagings) {
      if (lp.barcode && lp.active) {
        const trimmed = lp.barcode.trim()
        map.set(trimmed, { id: lp.id, name: lp.name, idpackaging: lp.idpackaging, barcode: trimmed })
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

  // Address editing
  const [editingAddress, setEditingAddress] = useState(false)
  const [addressForm, setAddressForm] = useState({
    deliveryname: '',
    deliverycontactname: '',
    deliveryaddress: '',
    deliveryzipcode: '',
    deliverycity: '',
    deliverycountry: '',
  })
  const [addressSaving, setAddressSaving] = useState(false)

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
  const [extraShipmentMode, setExtraShipmentMode] = useState(false)
  const [showClosePicklistConfirm, setShowClosePicklistConfirm] = useState(false)
  const [isClosingPicklist, setIsClosingPicklist] = useState(false)
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
        if (!res.ok) throw new Error(t.packing.fetchPicklistFailed)
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
        if (!res.ok) throw new Error(t.packing.fetchOrderFailed)
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

  const startEditAddress = useCallback(() => {
    if (!order) return
    setAddressForm({
      deliveryname: order.deliveryname || '',
      deliverycontactname: order.deliverycontactname || '',
      deliveryaddress: order.deliveryaddress || '',
      deliveryzipcode: order.deliveryzipcode || '',
      deliverycity: order.deliverycity || '',
      deliverycountry: order.deliverycountry || '',
    })
    setEditingAddress(true)
  }, [order])

  const saveAddress = useCallback(async () => {
    if (!order) return
    setAddressSaving(true)
    try {
      const res = await fetch(`/api/picqer/orders/${order.idorder}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addressForm),
      })
      if (!res.ok) throw new Error(t.packing.saveAddressFailed)
      const data = await res.json()
      setOrder(data.order)
      setEditingAddress(false)
    } catch (err) {
      console.error('Failed to save address:', err)
      alert(t.packing.saveAddressFailed)
    } finally {
      setAddressSaving(false)
    }
  }, [order, addressForm])

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
        if (!res.ok) throw new Error(t.packing.fetchEngineFailed)
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
  // Track with BOTH ref (for effect guard) and state (survives React 18 batching)
  // userModifiedBoxes: set to true when user manually removes a box — prevents auto-recreate
  const autoBoxCreatedRef = useRef(false)
  const [adviceApplied, setAdviceApplied] = useState(false)
  const userModifiedBoxesRef = useRef(false)
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
  // Helper: is the picklist in a terminal state (no further actions possible)?
  const isPicklistTerminal = picklist?.status === 'closed' || picklist?.status === 'cancelled'

  // Build remarks lookup from order products (PPS plant numbers)
  const orderRemarksMap = useMemo(() => {
    const map = new Map<number, string>()
    if (order?.products) {
      for (const op of order.products) {
        if (op.remarks && op.idproduct) {
          map.set(op.idproduct, op.remarks)
        }
      }
    }
    return map
  }, [order])

  const productItems: ProductCardItem[] = useMemo(() => {
    if (!picklist?.products || picklist.products.length === 0) {
      // Fallback: rebuild product list from session box products
      // This happens when picklist is cancelled in Picqer but session data remains
      if (session?.boxes) {
        const productMap = new Map<string, { productCode: string; name: string; totalAmount: number; boxId: string; sessionProductId: string }>()
        for (const box of session.boxes) {
          for (const sp of box.products) {
            const existing = productMap.get(sp.productcode)
            if (existing) {
              existing.totalAmount += sp.amount
            } else {
              productMap.set(sp.productcode, {
                productCode: sp.productcode,
                name: sp.productName,
                totalAmount: sp.amount,
                boxId: box.id,
                sessionProductId: sp.id,
              })
            }
          }
        }
        if (productMap.size > 0) {
          return Array.from(productMap.values()).map((p): ProductCardItem => ({
            id: p.sessionProductId,
            productCode: p.productCode,
            name: p.name,
            amount: p.totalAmount,
            amountPicked: p.totalAmount,
            weight: 0,
            imageUrl: null,
            location: '',
            assignedBoxId: p.boxId,
            amountAssigned: p.totalAmount,
            assignedBoxes: [{ boxId: p.boxId, boxName: '', boxIndex: 0, amount: p.totalAmount, sessionProductId: p.sessionProductId }],
            idpicklist_product: 0,
            idproduct: 0,
          }))
        }
      }
      return []
    }

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
        remarks: orderRemarksMap.get(pp.idproduct) ?? null,
      }
    }

    const items: ProductCardItem[] = []

    for (let index = 0; index < realProducts.length; index++) {
      const pp = realProducts[index]
      const locations = pp.pick_locations?.filter(l => l.amount > 0) ?? []

      if (locations.length > 1) {
        // Multi-location: distribute total assignments across location items
        const totalAssignments = getAssignments(pp)
        let totalAssigned = totalAssignments.reduce((sum, a) => sum + a.amount, 0)

        for (const loc of locations) {
          // This location item consumes up to loc.amount from the total assigned
          const locAssigned = Math.min(totalAssigned, loc.amount)
          totalAssigned -= locAssigned

          const assignedBoxId = locAssigned >= loc.amount && totalAssignments.length >= 1
            ? totalAssignments[0].boxId
            : null
          const firstSessionProductId = totalAssignments.length > 0 ? totalAssignments[0].sessionProductId : null
          const idSuffix = `${pp.idpicklist_product ?? index}-loc-${loc.idlocation ?? loc.name}`
          const id = firstSessionProductId && locAssigned > 0
            ? `${firstSessionProductId}-loc-${loc.idlocation ?? loc.name}`
            : `picklist-${idSuffix}-${pp.idproduct}`

          const compInfo = compositionMap.get(pp.idproduct)

          items.push({
            id,
            productCode: pp.productcode,
            name: pp.name,
            amount: loc.amount,
            amountPicked: loc.amount_picked,
            weight: 0,
            imageUrl: pp.image ?? null,
            location: loc.name,
            assignedBoxId,
            amountAssigned: locAssigned,
            assignedBoxes: locAssigned > 0 ? totalAssignments : [],
            customFields: productCustomFields.get(pp.idproduct),
            idpicklist_product: pp.idpicklist_product,
            idpicklist_product_location: loc.idpicklist_product_location,
            idproduct: pp.idproduct,
            compositionParent: compInfo && !compInfo.parentIsPackaging ? {
              name: compInfo.parentName,
              productCode: compInfo.parentProductCode,
              idproduct: compInfo.parentIdProduct,
            } : undefined,
          })
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
  }, [picklist, session, productCustomFields, packagingBarcodeMap, compositionMap, compositionParentIds, orderRemarksMap])

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
      return {
        id: box.id,
        packagingName: box.packagingName,
        packagingImageUrl: (box.picqerPackagingId && packagingImageMap.get(box.picqerPackagingId)) || null,
        picqerPackagingId: box.picqerPackagingId,
        products: box.products.map((sp): BoxProduct => {
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
        isClosed: closedBoxes.has(box.id) || box.status === 'closed',
        shipmentCreated: box.status === 'shipped' || box.status === 'label_fetched',
        trackingCode: box.trackingCode,
        trackingUrl: box.trackingUrl,
        labelUrl: box.labelUrl,
        shippedAt: box.shippedAt,
      }
    })
  }, [session, closedBoxes, picklist, packagingImageMap, compositionMap])

  // Filtered packagings for the add box modal — only packagings with a Picqer ID (required for shipments)
  const activePackagings = useMemo(() => {
    const picqerActive = packagings.filter((p) => p.active && p.idpackaging && p.idpackaging > 0)
    const picqerIds = new Set(picqerActive.map((p) => p.idpackaging))

    // Include local-only packagings that have a valid Picqer ID but don't exist in Picqer's active list
    const localOnly: PicqerPackaging[] = localPackagings
      .filter((lp) => lp.idpackaging > 0 && !picqerIds.has(lp.idpackaging))
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
  // Only runs ONCE per session — adviceApplied prevents re-triggering after all boxes are removed
  useEffect(() => {
    if (autoBoxCreatedRef.current || adviceApplied || userModifiedBoxesRef.current) return
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
      setAdviceApplied(true)

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
        const label = engineAdvice!.confidence === 'full_match' ? t.packing.fullMatch : t.packing.partialMatch
        const autoAssigned = engineBoxes.every(b => b.products.length > 0)
          ? ` — ${t.packing.productsAutoAssigned}`
          : ''
        setAutoBoxMessage(
          engineBoxes.length === 1
            ? `${label}: ${engineBoxes[0].packaging_name}${autoAssigned}`
            : `${label}: ${engineBoxes.length} ${t.packing.boxesCreated}${autoAssigned}`
        )
      }
      createBoxes()
    } else if (suggestedPackagings.length > 0) {
      // Fall back to tag-packaging mappings
      autoBoxCreatedRef.current = true
      setAdviceApplied(true)

      const createBoxes = async () => {
        for (const pkg of suggestedPackagings) {
          await addBox(pkg.name, pkg.idpackaging, pkg.barcode ?? undefined)
        }
        setAutoBoxMessage(
          suggestedPackagings.length === 1
            ? `${t.packing.boxAutoCreated}: ${suggestedPackagings[0].name}`
            : `${suggestedPackagings.length} ${t.packing.boxesAutoCreated}`
        )
      }
      createBoxes()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps — addBox/assignProduct excluded: they update state which re-triggers the effect
  }, [session?.boxes?.length, session?.id, picklist, suggestedPackagings, packagingsLoading, engineAdvice, engineLoading, activePackagings, adviceApplied])

  // Auto-dismiss auto-box message
  useEffect(() => {
    if (!autoBoxMessage) return
    const timer = setTimeout(() => setAutoBoxMessage(null), 5000)
    return () => clearTimeout(timer)
  }, [autoBoxMessage])

  // Computed values
  const assignedProductsCount = productItems.filter((p) => p.amountAssigned >= p.amount).length
  const totalProductsCount = productItems.length

  // Set of box IDs that are closed or shipped (used to protect products from removal)
  const closedBoxIds = useMemo(() => {
    if (!session) return new Set<string>()
    const ids = new Set<string>()
    for (const box of session.boxes) {
      if (box.status === 'closed' || box.status === 'shipped' || box.status === 'label_fetched') {
        ids.add(box.id)
      }
    }
    return ids
  }, [session])

  // Auto-open shipment modal when all products are in closed boxes
  const autoShipTriggeredRef = useRef(false)
  useEffect(() => {
    if (!session || !picklist || session.status === 'completed' || picklist.status === 'closed' || picklist.status === 'cancelled') return
    if (showShipmentModal || autoShipTriggeredRef.current) return
    if (session.boxes.length === 0) return
    if (totalProductsCount === 0) return

    // Check: all products assigned
    if (assignedProductsCount < totalProductsCount) return

    // Check: all boxes with products are closed
    const boxesWithProducts = session.boxes.filter(b => b.products.length > 0)
    const allWithProductsClosed = boxesWithProducts.length > 0 && boxesWithProducts.every(
      b => b.status === 'closed' || b.status === 'shipped' || b.status === 'label_fetched'
    )
    if (!allWithProductsClosed) return

    // Auto-remove empty open boxes
    const emptyOpenBoxes = session.boxes.filter(b => b.products.length === 0 && b.status !== 'closed' && b.status !== 'shipped' && b.status !== 'label_fetched')
    for (const box of emptyOpenBoxes) {
      removeBox(box.id)
    }

    // Open shipment modal
    autoShipTriggeredRef.current = true
    setShowShipmentModal(true)
  }, [session, picklist, showShipmentModal, totalProductsCount, assignedProductsCount, removeBox])

  // Reset all auto-triggers when navigating to a new picklist
  useEffect(() => {
    autoShipTriggeredRef.current = false
    autoBoxCreatedRef.current = false
    userModifiedBoxesRef.current = false
    setAdviceApplied(false)
  }, [sessionId])

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

      // Extra zending mode: open shipment dialog after box creation
      if (extraShipmentMode) {
        setExtraShipmentMode(false)
        setShowShipmentModal(true)
      }
    },
    [addBox, engineAdvice, extraShipmentMode]
  )

  const handleRemoveBox = useCallback(
    async (boxId: string) => {
      userModifiedBoxesRef.current = true
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
    (providerId: number, weights?: Map<string, number>, boxIds?: string[]) => {
      shipAllBoxes(providerId, weights, packingStationId, boxIds)
    },
    [shipAllBoxes, packingStationId]
  )

  const handleClosePicklist = useCallback(async () => {
    if (!session?.picklistId) return
    setIsClosingPicklist(true)
    try {
      // Pick all products first (required before closing in Picqer)
      try {
        await fetch(`/api/picqer/picklists/${session.picklistId}/pick`, { method: 'POST' })
      } catch {
        // Non-blocking — continue with close
      }
      const res = await fetch(`/api/picqer/picklists/${session.picklistId}/close`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setScanFeedback({ message: data.error || t.packing.closePicklistFailed, type: 'error' })
        return
      }
      // Mark session as completed
      await completeSession()
      setScanFeedback({ message: t.packing.picklistClosed, type: 'success' })
    } catch {
      setScanFeedback({ message: t.packing.closePicklistFailed, type: 'error' })
    } finally {
      setIsClosingPicklist(false)
      setShowClosePicklistConfirm(false)
    }
  }, [session?.picklistId, completeSession])

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
        setScanFeedback({ message: t.packing.shipmentCancelled, type: 'success' })
      } else if (result.error) {
        setScanFeedback({ message: `${t.packing.cancelFailed}: ${result.error}`, type: 'error' })
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
        setScanFeedback({ message: `${t.packing.boxCreated}: ${matchedPackaging.name}`, type: 'success' })
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
          setScanFeedback({ message: t.packing.addBoxFirst, type: 'warning' })
          return
        }
        const remaining = matchedProduct.amount - matchedProduct.amountAssigned
        handleAssignProduct(matchedProduct.id, openBox.id, remaining)
        setHighlightProductId(matchedProduct.id)
        const openBoxDisplayIndex = (session?.boxes.findIndex((b) => b.id === openBox.id) ?? 0) + 1
        setScanFeedback({ message: `${matchedProduct.productCode} (${remaining}x) → ${t.packing.boxNumber} ${openBoxDisplayIndex}`, type: 'success' })
        return
      }

      // 3. Check if product exists but is already fully assigned
      const alreadyAssigned = productItems.find(
        (p) => p.productCode.toLowerCase() === barcode.toLowerCase() && p.amountAssigned >= p.amount
      )
      if (alreadyAssigned) {
        setScanFeedback({ message: `${barcode} ${t.packing.alreadyFullyAssigned}`, type: 'warning' })
        return
      }

      // 4. No match
      setScanFeedback({ message: `${t.packing.scanUnknownBarcode}: ${barcode}`, type: 'error' })
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
          <p className="text-muted-foreground">{t.packing.loadingSession}</p>
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
          <p className="text-red-600 font-medium">{t.packing.loadSessionError}</p>
          <p className="text-sm text-muted-foreground">{sessionError.message}</p>
          <button
            onClick={onBack}
            className="mt-2 px-4 py-2 min-h-[48px] text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            {t.packing.backToBatches}
          </button>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">{t.packing.noSessionFound}</p>
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
            picklists={sortedBatchPicklists}
            currentPicklistId={session?.picklistId ?? 0}
            onNavigate={handleBatchNavigate}
            onBatchClick={onBack}
            isNavigating={isNavCreatingSession}
            sessionCompleted={session.status === 'completed'}
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
                      ? t.packing.pleaseWait
                      : t.packing.leaveSessionConfirm}
                  </p>
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-600 flex-shrink-0" />
                  ) : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={onBack}
                        className="px-3 py-1.5 min-h-[44px] bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors"
                      >
                        {t.packing.leaveSession}
                      </button>
                      <button
                        onClick={() => setShowLeaveConfirm(false)}
                        className="px-3 py-1.5 min-h-[44px] border border-border text-muted-foreground rounded-lg text-sm font-medium hover:bg-muted transition-colors"
                      >
                        {t.common.cancel}
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
                      title={t.packing.backToBatches}
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base lg:text-lg font-semibold truncate">
                        {picklist?.picklistid ?? `Picklist #${session.picklistId}`}
                      </span>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded flex-shrink-0 ${
                        picklist?.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                        session.status === 'completed' ? 'bg-green-100 text-green-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {picklist?.status === 'cancelled' ? translateStatus('cancelled', t.status) : translateStatus(session.status, t.status)}
                      </span>
                      {isSaving && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t.common.saving}
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
                          {selectedStation ? selectedStation.name : t.packing.noStation}
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
                          {selectedStation ? selectedStation.name : t.packing.noStation}
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
                      ? 'bg-green-100 text-green-800'
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
                  <span>{assignedProductsCount} / {totalProductsCount} {t.packing.productsAssigned}</span>
                </div>
              </div>
              {/* Session info toggle - only on small screens */}
              <button
                onClick={() => setShowSessionInfo(!showSessionInfo)}
                className="lg:hidden p-2 rounded-lg hover:bg-muted transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                title={t.packing.sessionInfo}
              >
                <Info className="w-5 h-5 text-muted-foreground" />
              </button>
              {/* Close picklist button */}
              {session.status !== 'completed' && !isPicklistTerminal && (
                <button
                  onClick={() => setShowClosePicklistConfirm(true)}
                  disabled={isClosingPicklist}
                  className="flex items-center gap-2 px-3 py-2 min-h-[44px] border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors text-muted-foreground"
                  title={t.packing.closePicklist}
                >
                  <Check className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.packing.closePicklist}</span>
                </button>
              )}
              {/* Ship All button */}
              {session.boxes.length > 0 && !isPicklistTerminal && (
                <button
                  onClick={() => setShowShipmentModal(true)}
                  className="flex items-center gap-2 px-3 py-2 lg:px-4 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors border border-primary"
                >
                  <Send className="w-4 h-4" />
                  <span className="hidden sm:inline">{t.packing.shipAll}</span>
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
                <p className="text-xs text-muted-foreground">{t.packing.workerLabel}</p>
                <p className="font-medium">{workerName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="font-medium">{translateStatus(session.status, t.status)}</p>
              </div>
              {picklist && (
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.totalProducts}</p>
                  <p>{picklist.totalproducts} ({picklist.totalpicked} {t.packing.picked})</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">{t.packing.boxesLabel}</p>
                <p>{session.boxes.length}</p>
              </div>
            </div>
            {/* Delivery address (mobile) */}
            {order && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">{t.packing.delivery}</p>
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

        {/* PPS plant number banner */}
        {orderRemarksMap.size > 0 && (
          <div className="px-3 pt-2 lg:px-4">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border-2 border-orange-300 text-orange-800">
              <span className="px-2 py-0.5 text-xs font-bold bg-orange-500 text-white rounded flex-shrink-0">PPS</span>
              <span className="text-sm font-semibold">
                {[...orderRemarksMap.values()].join(' · ')}
              </span>
            </div>
          </div>
        )}

        {/* Engine packaging advice banner */}
        {engineAdvice && (
          <div className="px-3 pt-2 lg:px-4">
            <button
              onClick={() => setAdviceDetailsExpanded(!adviceDetailsExpanded)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${
                engineAdvice.confidence === 'full_match'
                  ? 'bg-green-50 border border-green-200 text-green-800 hover:bg-green-100'
                  : engineAdvice.confidence === 'partial_match'
                    ? 'bg-blue-50 border border-blue-200 text-blue-800 hover:bg-blue-100'
                    : 'bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100'
              }`}
            >
              <Sparkles className={`w-4 h-4 flex-shrink-0 ${
                engineAdvice.confidence === 'full_match' ? 'text-green-600'
                  : engineAdvice.confidence === 'partial_match' ? 'text-blue-600'
                    : 'text-amber-600'
              }`} />
              <span className="flex-1">
                {engineAdvice.confidence === 'full_match' && (
                  <>
                    Advies: {engineAdvice.advice_boxes.map((b) => b.packaging_name).join(' + ')}
                    {engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                      <span className="ml-1 font-medium">
                        ({formatCost(engineAdvice.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))} {t.packing.totalCost})
                      </span>
                    )}
                  </>
                )}
                {engineAdvice.confidence === 'partial_match' && (
                  <>
                    Gedeeltelijk advies: {engineAdvice.advice_boxes.map((b) => b.packaging_name).join(' + ')}
                    {engineAdvice.cost_data_available !== false && engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                      <span className="ml-1 font-medium">
                        ({formatCost(engineAdvice.advice_boxes.reduce((sum, b) => sum + (b.total_cost ?? 0), 0))} {t.packing.totalCost})
                      </span>
                    )}
                  </>
                )}
                {engineAdvice.confidence === 'no_match' && (
                  <>{t.packing.noAdviceAvailable}</>
                )}
                {engineAdvice.unclassified_products.length > 0 && engineAdvice.confidence !== 'no_match' && (
                  <span className="text-xs ml-1 opacity-75">
                    ({engineAdvice.unclassified_products.length} {engineAdvice.unclassified_products.length !== 1 ? t.common.products : t.common.product} {t.packing.notClassified})
                  </span>
                )}
                {engineAdvice.weight_exceeded && (
                  <span className="text-xs ml-1 text-amber-700 font-medium">
                    — {t.packing.weightExceeded}
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${adviceDetailsExpanded ? 'rotate-180' : ''} ${
                engineAdvice.confidence === 'full_match' ? 'text-green-500'
                  : engineAdvice.confidence === 'partial_match' ? 'text-blue-500'
                    : 'text-amber-500'
              }`} />
            </button>
            {adviceDetailsExpanded && (
              <div className={`mt-1 rounded-lg text-xs overflow-hidden border ${
                engineAdvice.confidence === 'full_match'
                  ? 'border-green-200'
                  : engineAdvice.confidence === 'partial_match'
                    ? 'border-blue-200'
                    : 'border-amber-200'
              }`}>
                {/* Context row */}
                <div className={`px-3 py-2 flex flex-wrap gap-x-4 gap-y-1 ${
                  engineAdvice.confidence === 'full_match' ? 'bg-green-50/50 text-green-700'
                    : engineAdvice.confidence === 'partial_match' ? 'bg-blue-50/50 text-blue-700'
                      : 'bg-amber-50/50 text-amber-700'
                }`}>
                  {order?.deliverycountry && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {getCountryName(order.deliverycountry, t.countries)}
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
                    {t.packing.unclassified}: {engineAdvice.unclassified_products.join(', ')}
                  </div>
                )}
                {engineAdvice.confidence === 'no_match' && engineAdvice.shipping_units_detected.length > 0 && (
                  <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {t.packing.noPackagingMatch}
                  </div>
                )}
                {engineAdvice.cost_data_available === false && (
                  <div className="px-3 py-1.5 bg-amber-50 border-t border-amber-200 text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    {t.packing.noCostData}
                  </div>
                )}

                {/* Cost breakdown per box */}
                {engineAdvice.advice_boxes.some(b => b.total_cost !== undefined) && (
                  <div className="border-t border-inherit">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30 text-muted-foreground">
                          <th className="text-left py-1.5 px-3 font-medium">{t.packing.engineAdvice}</th>
                          <th className="text-right py-1.5 px-2 font-medium">{t.packing.material}</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pick</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pack</th>
                          <th className="text-right py-1.5 px-2 font-medium">Transport</th>
                          <th className="text-right py-1.5 px-3 font-medium">{t.packing.totalCost}</th>
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
                            <td className="py-1.5 px-3">{t.packing.totalCost} ({engineAdvice.advice_boxes.length} {t.packing.boxesLabel})</td>
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
                      {t.packing.allMatchingPackagings}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/10 text-muted-foreground">
                          <th className="text-left py-1.5 px-3 font-medium">{t.packing.packaging}</th>
                          <th className="text-right py-1.5 px-2 font-medium">{t.packing.material}</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pick</th>
                          <th className="text-right py-1.5 px-2 font-medium">Pack</th>
                          <th className="text-right py-1.5 px-2 font-medium">Transport</th>
                          <th className="text-left py-1.5 px-2 font-medium">Carrier</th>
                          <th className="text-right py-1.5 px-3 font-medium">{t.packing.totalCost}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {engineAdvice.alternatives.map((alt) => (
                          <tr key={alt.packaging_id} className={`border-t border-inherit ${alt.is_recommended ? 'bg-green-50/30' : ''}`}>
                            <td className="py-1.5 px-3">
                              <span className={alt.is_recommended ? 'font-semibold' : ''}>{alt.name}</span>
                              {alt.is_recommended && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">{t.packing.suggested}</span>
                              )}
                              {alt.is_cheapest && !alt.is_recommended && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700">{t.packing.cheapest}</span>
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
              <span>{t.packing.calculatingAdvice}</span>
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
                  title={t.common.close}
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
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
              <Tag className="w-4 h-4 flex-shrink-0 text-green-600" />
              <span className="flex-1">{autoBoxMessage}</span>
              <button
                onClick={() => setAutoBoxMessage(null)}
                className="p-1 -mr-1 rounded hover:bg-green-200/50 transition-colors flex-shrink-0"
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
                ? 'bg-green-50 border-green-200 text-green-800'
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
                {outcomeFeedback.outcome === 'followed' ? t.packing.engineAdviceFollowed
                  : outcomeFeedback.outcome === 'modified' ? (
                    outcomeFeedback.deviationType === 'extra_boxes' ? t.packing.engineModifiedExtraBoxes :
                    outcomeFeedback.deviationType === 'fewer_boxes' ? t.packing.engineModifiedFewerBoxes :
                    outcomeFeedback.deviationType === 'different_packaging' ? t.packing.engineModifiedDifferentPkg :
                    t.packing.engineModified
                  )
                  : outcomeFeedback.outcome === 'ignored' ? t.packing.engineIgnored
                  : t.packing.sessionCompleted}
              </span>
              <button
                onClick={() => setOutcomeFeedback(null)}
                className={`p-1 -mr-1 rounded transition-colors flex-shrink-0 ${
                  outcomeFeedback.outcome === 'followed'
                    ? 'hover:bg-green-200/50'
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

        {/* Completed banner + quick actions — shown when picklist is closed or session completed */}
        {(isPicklistTerminal || session.status === 'completed') && (
          <CompletedView
            session={session}
            nextPicklist={nextPicklistInBatch}
            isBatchCompleted={isBatchCompleted}
            batchProgress={batchContext ? {
              completed: batchContext.picklists.filter(pl => pl.status === 'closed').length,
              total: batchContext.picklists.length,
            } : undefined}
            onNextPicklist={() => nextPicklistInBatch && handleBatchNavigate(nextPicklistInBatch)}
            onBackToBatches={onBack}
            onExtraShipment={handleExtraShipment}
            sessionId={sessionId}
          />
        )}

        {/* Feedback toast for completed view */}
        {(isPicklistTerminal || session.status === 'completed') && scanFeedback && (
          <div className={`px-3 py-2 lg:px-4 border-b ${
            scanFeedback.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
            scanFeedback.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' :
            'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            <div className="flex items-center gap-2 text-sm">
              {scanFeedback.type === 'success' ? <Check className="w-4 h-4" /> :
               scanFeedback.type === 'error' ? <AlertCircle className="w-4 h-4" /> :
               <AlertTriangle className="w-4 h-4" />}
              {scanFeedback.message}
            </div>
          </div>
        )}

        {/* Content area — always shown, read-only when completed */}
        {(isPicklistTerminal || session.status === 'completed') ? (
          <>
        {/* Read-only product/box view for completed sessions */}
        <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="flex flex-col lg:flex-row flex-1 min-h-0">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
              {/* Products column (read-only) */}
              <div className="flex-col lg:!flex lg:w-1/2 border-r border-border flex flex-1 lg:flex-none">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <h2 className="font-semibold flex items-center gap-2 text-muted-foreground">
                    <Package className="w-4 h-4" />
                    {t.packing.productsTab} ({totalProductsCount})
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-2 opacity-75">
                  {productItems.map((product) => (
                    <div key={product.id} className="flex items-center gap-3 p-2 bg-muted/30 rounded-lg">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded object-cover flex-shrink-0" />
                      ) : (
                        <div className="w-10 h-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                          <Package className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground">{product.productCode} · {product.amount}x</p>
                      </div>
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-500 text-white flex-shrink-0">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Boxes column (read-only) */}
              <div className="flex-col lg:!flex lg:w-1/2 flex flex-1 lg:flex-none">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <h2 className="font-semibold flex items-center gap-2 text-muted-foreground">
                    <Box className="w-4 h-4" />
                    {t.packing.boxesTab} ({session.boxes.length})
                  </h2>
                </div>
                <div className="flex-1 overflow-y-auto p-3 lg:p-4 space-y-3">
                  {session.boxes.map((box) => {
                    const isShipped = box.status === 'shipped' || box.status === 'label_fetched'
                    const isCancelled = box.status === 'cancelled'
                    return (
                    <div key={box.id} className={`border rounded-lg p-3 ${
                      isCancelled ? 'border-red-300 bg-red-50/50' :
                      isShipped ? 'border-green-300 bg-green-50/50' :
                      'border-border bg-muted/30'
                    }`}>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          isCancelled ? 'bg-red-500 text-white' :
                          isShipped ? 'bg-green-500 text-white' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {isCancelled ? <XCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          {isCancelled ? t.status.cancelled : isShipped ? t.status.shipped : box.status === 'closed' ? t.status.closed : t.status.open}
                        </span>
                        <span className="text-sm font-bold truncate">{box.packagingName}</span>
                        <span className="text-xs text-muted-foreground">{box.products.length} prod</span>
                        {box.trackingCode && (
                          box.trackingUrl ? (
                            <a href={box.trackingUrl} target="_blank" rel="noopener noreferrer" className={`font-mono text-xs hover:underline ml-auto ${isCancelled ? 'text-muted-foreground line-through' : 'text-primary'}`}>
                              {box.trackingCode}
                            </a>
                          ) : (
                            <span className={`font-mono text-xs ml-auto ${isCancelled ? 'text-muted-foreground line-through' : 'text-muted-foreground'}`}>{box.trackingCode}</span>
                          )
                        )}
                        {isShipped && !isCancelled && (
                          <button
                            onClick={() => handleCancelShipment(box.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded transition-colors ml-auto flex-shrink-0"
                            title={t.packing.cancelShipment}
                          >
                            <XCircle className="w-3 h-3" />
                            {t.packing.cancelShipmentBtn}
                          </button>
                        )}
                        {!isShipped && !isCancelled && !box.trackingCode && (
                          <button
                            onClick={() => {
                              setShipmentModalBoxId(box.id)
                              setShowShipmentModal(true)
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:text-primary/80 hover:bg-primary/10 border border-primary/30 rounded transition-colors ml-auto flex-shrink-0"
                          >
                            <Truck className="w-3 h-3" />
                            {t.shipment.createSingle}
                          </button>
                        )}
                      </div>
                      {box.products.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {box.products.map((p) => (
                            <p key={p.id} className="text-xs text-muted-foreground pl-1">
                              {p.amount}x {p.productName}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - read-only for completed sessions (desktop only) */}
          <div className="w-64 xl:w-72 border-l border-border flex-shrink-0 bg-muted/20 overflow-y-auto hidden lg:block">
            {/* Panel 1: Bezorging */}
            <SidebarPanel
              title={t.packing.delivery}
              icon={<MapPin className="w-4 h-4" />}
              isExpanded={expandedPanels.has('delivery')}
              onToggle={() => togglePanel('delivery')}
            >
              {orderLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.common.loading}
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
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground">{t.packing.shippingProfile}</p>
                      {picklist?.idshippingprovider_profile ? (
                        <p className="text-xs font-medium">{shippingProfileName ?? `#${picklist.idshippingprovider_profile}`}</p>
                      ) : (
                        <p className="text-xs font-medium text-amber-600">Geen verzendprofiel geselecteerd</p>
                      )}
                    </div>
                  </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t.packing.noDeliveryInfo}</p>
              )}
            </SidebarPanel>

            {/* Panel 2: Details */}
            <SidebarPanel
              title={t.packing.details}
              icon={<Tag className="w-4 h-4" />}
              isExpanded={expandedPanels.has('details')}
              onToggle={() => togglePanel('details')}
            >
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.workerLabel}</p>
                  <p className="font-medium">{workerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.picklistLabel}</p>
                  <p className="font-medium">{picklist?.picklistid ?? session.picklistId}</p>
                </div>
                {order && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.orderLabel}</p>
                      <p className="font-medium">{order.orderid}</p>
                    </div>
                    {order.reference && (
                      <div>
                        <p className="text-xs text-muted-foreground">{t.packing.referenceLabel}</p>
                        <p className="font-medium">{order.reference}</p>
                      </div>
                    )}
                  </>
                )}
                {order && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.orderStatus}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      order.status === 'completed' ? 'bg-green-100 text-green-800' :
                      order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      order.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(order.status, t.status)}
                    </span>
                  </div>
                )}
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.picklistStatus}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      picklist.status === 'new' ? 'bg-yellow-100 text-yellow-800' :
                      picklist.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      picklist.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(picklist.status, t.status)}
                    </span>
                  </div>
                )}
                {order?.orderfields && (() => {
                  const leverdag = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.LEVERDAG)
                  return leverdag?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.deliveryDay}</p>
                      <p className="font-medium">{leverdag.value}</p>
                    </div>
                  ) : null
                })()}
                {order?.orderfields && (() => {
                  const retailer = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.RETAILER_NAME)
                  return retailer?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.retailerLabel}</p>
                      <p className="font-medium">{retailer.value}</p>
                    </div>
                  ) : null
                })()}
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.sessionStatus}</p>
                  <p className="font-medium">{translateStatus(session.status, t.status)}</p>
                </div>
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.productsLabel}</p>
                    <p>{picklist.totalproducts} ({picklist.totalpicked} {t.packing.picked})</p>
                  </div>
                )}
                {picklist?.tags && picklist.tags.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t.packing.tagsLabel}</p>
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
                  <p className="text-xs text-muted-foreground">{t.packing.createdAt}</p>
                  <p className="text-xs">
                    {new Date(session.createdAt).toLocaleString('nl-NL')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.boxesLabel}</p>
                  <p>{session.boxes.length}</p>
                </div>
              </div>
            </SidebarPanel>

            {/* Panel 3: Zendingen */}
            <SidebarPanel
              title={t.packing.shipments}
              icon={<Truck className="w-4 h-4" />}
              isExpanded={expandedPanels.has('shipments')}
              onToggle={() => togglePanel('shipments')}
            >
              {session.boxes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.shipment.noBoxes}</p>
              ) : (
                <div className="space-y-2">
                  {session.boxes.map((box, i) => {
                    const statusBadge = box.status === 'shipped'
                      ? 'bg-green-100 text-green-700'
                      : box.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground'
                    return (
                      <div key={box.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.packing.boxNumber} {i + 1}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${statusBadge}`}>
                            {translateStatus(box.status, t.status)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {box.packagingName} · {box.products.length} {box.products.length !== 1 ? t.common.products : t.common.product}
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
                            {t.packing.labelOpen}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {box.shippedAt && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {t.packing.shippedAt} {new Date(box.shippedAt).toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </SidebarPanel>
          </div>
        </div>
        {/* Comments section — full width below columns, also in completed view */}
        <div className="border-t border-border">
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
          </>
        ) : (<>
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
              <span>{t.packing.productsTab} ({totalProductsCount})</span>
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
              <span>{t.packing.boxesTab} ({session.boxes.length})</span>
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
              <span className="flex-shrink-0">{assignedProductsCount}/{totalProductsCount} {t.packing.assigned}</span>
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
                  {allUnassignedSelected ? t.packing.deselectAll : t.packing.selectAll}
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
                      {selectedCount} {t.packing.assign}
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
                              {t.packing.assignToBox}
                            </p>
                            {boxRefs.filter((b) => !b.isClosed).map((box) => (
                              <button
                                key={box.id}
                                onClick={() => handleBulkAssign(box.id)}
                                className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left"
                              >
                                <Box className="w-4 h-4 text-muted-foreground" />
                                <span>{t.packing.boxNumber} {box.index}: {box.name}</span>
                              </button>
                            ))}
                            {boxRefs.filter((b) => !b.isClosed).length === 0 && (
                              <p className="px-2 py-2 text-xs text-muted-foreground">
                                {t.packing.noOpenBoxes}
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
                      {t.packing.productsTab} ({totalProductsCount})
                    </h2>
                    {unassignedProducts.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleSelectAll}
                          className="text-xs text-primary hover:underline"
                        >
                          {allUnassignedSelected ? t.packing.deselectAll : t.packing.selectAll}
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
                              {selectedCount} {t.packing.assign}
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
                                      {t.packing.assignToBox}
                                    </p>
                                    {boxRefs.filter((b) => !b.isClosed).map((box) => (
                                      <button
                                        key={box.id}
                                        onClick={() => handleBulkAssign(box.id)}
                                        className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded-lg hover:bg-muted transition-colors text-left"
                                      >
                                        <Box className="w-4 h-4 text-muted-foreground" />
                                        <span>{t.packing.boxNumber} {box.index}: {box.name}</span>
                                      </button>
                                    ))}
                                    {boxRefs.filter((b) => !b.isClosed).length === 0 && (
                                      <p className="px-2 py-2 text-xs text-muted-foreground">
                                        {t.packing.noOpenBoxes}
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
                      <span className="ml-2 text-sm text-muted-foreground">{t.packing.loadingProducts}</span>
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
                          closedBoxIds={closedBoxIds}
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
                    {t.packing.boxesTab} ({session.boxes.length})
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
                        readOnly={picklist?.status === 'cancelled'}
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
                      {t.packing.addBox}
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
              title={t.packing.delivery}
              icon={<MapPin className="w-4 h-4" />}
              isExpanded={expandedPanels.has('delivery')}
              onToggle={() => togglePanel('delivery')}
            >
              {orderLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {t.common.loading}
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
                    <button
                      onClick={startEditAddress}
                      className="inline-flex items-center gap-1 mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded hover:bg-muted transition-colors"
                    >
                      <Pencil className="w-3 h-3" />
                      {t.packing.editAddress}
                    </button>
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground">{t.packing.shippingProfile}</p>
                      {picklist?.idshippingprovider_profile ? (
                        <p className="text-xs font-medium">{shippingProfileName ?? `#${picklist.idshippingprovider_profile}`}</p>
                      ) : (
                        <p className="text-xs font-medium text-amber-600">Geen verzendprofiel geselecteerd</p>
                      )}
                    </div>
                  </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t.packing.noDeliveryInfo}</p>
              )}
            </SidebarPanel>

            {/* Panel 2: Details */}
            <SidebarPanel
              title={t.packing.details}
              icon={<Tag className="w-4 h-4" />}
              isExpanded={expandedPanels.has('details')}
              onToggle={() => togglePanel('details')}
            >
              <div className="space-y-2 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.workerLabel}</p>
                  <p className="font-medium">{workerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.picklistLabel}</p>
                  <p className="font-medium">{picklist?.picklistid ?? session.picklistId}</p>
                </div>
                {order && (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.orderLabel}</p>
                      <p className="font-medium">{order.orderid}</p>
                    </div>
                    {order.reference && (
                      <div>
                        <p className="text-xs text-muted-foreground">{t.packing.referenceLabel}</p>
                        <p className="font-medium">{order.reference}</p>
                      </div>
                    )}
                  </>
                )}
                {order && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.orderStatus}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      order.status === 'completed' ? 'bg-green-100 text-green-800' :
                      order.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      order.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(order.status, t.status)}
                    </span>
                  </div>
                )}
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.picklistStatus}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                      picklist.status === 'new' ? 'bg-yellow-100 text-yellow-800' :
                      picklist.status === 'paused' ? 'bg-amber-100 text-amber-800' :
                      picklist.status === 'cancelled' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {translateStatus(picklist.status, t.status)}
                    </span>
                  </div>
                )}
                {order?.orderfields && (() => {
                  const leverdag = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.LEVERDAG)
                  return leverdag?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.deliveryDay}</p>
                      <p className="font-medium">{leverdag.value}</p>
                    </div>
                  ) : null
                })()}
                {order?.orderfields && (() => {
                  const retailer = order.orderfields.find((f: PicqerOrderfield) => f.idorderfield === ORDERFIELD_IDS.RETAILER_NAME)
                  return retailer?.value ? (
                    <div>
                      <p className="text-xs text-muted-foreground">{t.packing.retailerLabel}</p>
                      <p className="font-medium">{retailer.value}</p>
                    </div>
                  ) : null
                })()}
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.sessionStatus}</p>
                  <p className="font-medium">{translateStatus(session.status, t.status)}</p>
                </div>
                {picklist && (
                  <div>
                    <p className="text-xs text-muted-foreground">{t.packing.productsLabel}</p>
                    <p>{picklist.totalproducts} ({picklist.totalpicked} {t.packing.picked})</p>
                  </div>
                )}
                {picklist?.tags && picklist.tags.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t.packing.tagsLabel}</p>
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
                  <p className="text-xs text-muted-foreground">{t.packing.createdAt}</p>
                  <p className="text-xs">
                    {new Date(session.createdAt).toLocaleString('nl-NL')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{t.packing.boxesLabel}</p>
                  <p>{session.boxes.length}</p>
                </div>
              </div>
            </SidebarPanel>

            {/* Panel 3: Zendingen */}
            <SidebarPanel
              title={t.packing.shipments}
              icon={<Truck className="w-4 h-4" />}
              isExpanded={expandedPanels.has('shipments')}
              onToggle={() => togglePanel('shipments')}
            >
              {session.boxes.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.shipment.noBoxes}</p>
              ) : (
                <div className="space-y-2">
                  {session.boxes.map((box, i) => {
                    const statusBadge = box.status === 'shipped'
                      ? 'bg-green-100 text-green-700'
                      : box.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-muted text-muted-foreground'
                    return (
                      <div key={box.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{t.packing.boxNumber} {i + 1}</span>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${statusBadge}`}>
                            {translateStatus(box.status, t.status)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {box.packagingName} · {box.products.length} {box.products.length !== 1 ? t.common.products : t.common.product}
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
                            {t.packing.labelOpen}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {box.shippedAt && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {t.packing.shippedAt} {new Date(box.shippedAt).toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </SidebarPanel>

          </div>
        </div>
        </>)}
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
          setExtraShipmentMode(false)
        }}
        title={extraShipmentMode ? t.completed.extraShipment : t.packing.addBox}
        className="max-w-5xl max-h-[90vh] flex flex-col"
      >
        <div className="flex flex-col overflow-hidden">
          {/* Sticky search input */}
          <div className="p-4 pb-0">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.packing.searchPackaging}
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
                <h4 className="text-xs font-medium text-green-700 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  Engine advies
                  {engineAdvice.advice_boxes.length > 1 && (
                    <span className="text-green-600 normal-case">— {engineAdvice.advice_boxes.length} {t.packing.boxesRecommended}</span>
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
                        className="flex flex-col items-center p-3 rounded-lg border-2 border-green-300 bg-green-50 hover:bg-green-100 active:bg-green-200 transition-colors text-center min-h-[140px]"
                      >
                        {engineAdvice.advice_boxes.length > 1 && (
                          <span className="text-[10px] font-medium text-green-600 mb-1">{t.packing.boxNumber} {idx + 1} {t.common.of} {engineAdvice.advice_boxes.length}</span>
                        )}
                        <div className="w-16 h-16 bg-green-100 rounded-lg flex items-center justify-center mb-2">
                          {packagingImageMap.get(adviceBox.idpackaging) ? (
                            <img
                              src={packagingImageMap.get(adviceBox.idpackaging)}
                              alt={adviceBox.packaging_name}
                              className="w-16 h-16 rounded-lg object-cover"
                            />
                          ) : (
                            <Sparkles className="w-7 h-7 text-green-600" />
                          )}
                        </div>
                        <p className="font-medium text-sm leading-tight line-clamp-2">{adviceBox.packaging_name}</p>
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                          {adviceBox.products.map((p) => `${p.quantity}x ${p.shipping_unit_name}`).join(', ')}
                        </p>
                        {adviceBox.total_cost !== undefined && (
                          <p className="text-xs text-green-700 font-medium mt-1">
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
                  <span className="ml-2 text-sm text-muted-foreground">{t.packing.loadingPackagings}</span>
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
                      {t.packing.noPackagings}
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
                          ? `${tagFilter.label} ${t.packing.packagingsLabel} (${tagFilteredPackagings.length})`
                          : `${t.packing.allPackagings} (${activePackagings.length})`}
                      </h4>
                    </button>
                  ) : (
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      {tagFilter
                        ? `${tagFilter.label} ${t.packing.packagingsLabel} (${tagFilteredPackagings.length})`
                        : `${t.packing.allPackagings} (${activePackagings.length})`}
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
                              {t.packing.noPicqerId}
                            </p>
                          )}
                        </button>
                      ))}
                      {filteredPackagings.filter((pkg) => !suggestedPackagingIds.has(pkg.idpackaging) && !engineAdviceIds.has(pkg.idpackaging)).length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4 col-span-full">
                          {t.packing.noPackagings}
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
        title={t.packing.station}
        className="max-w-md"
      >
        <div className="p-4">
          <p className="text-sm text-muted-foreground mb-4">
            {t.packing.stationDescription}
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
                <p className="text-sm font-medium">{t.common.no}</p>
                <p className="text-xs text-muted-foreground">{t.packing.labelsInBrowser}</p>
              </div>
              {!selectedStation && <Check className="w-4 h-4 text-primary ml-auto flex-shrink-0" />}
            </button>
            {stations.map((station) => {
              const isSelected = selectedStation?.id === station.id
              const status = station.printer_status ?? 'unknown'
              const cfg = STATUS_CONFIG[status]
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
                    <div className={`flex items-center gap-1.5 mt-0.5 text-xs font-medium ${cfg.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {language === 'nl' ? cfg.labelNl : cfg.labelEn}
                      {station.computer_name && (
                        <span className="text-muted-foreground font-normal">· {station.computer_name}</span>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      </Dialog>

      {/* Address edit modal */}
      {editingAddress && order && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditingAddress(false)}>
          <div className="bg-card rounded-xl shadow-xl p-6 mx-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t.packing.editAddressTitle}</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">{t.packing.name}</label>
                <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliveryname} onChange={(e) => setAddressForm((f) => ({ ...f, deliveryname: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t.packing.contactPerson}</label>
                <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliverycontactname} onChange={(e) => setAddressForm((f) => ({ ...f, deliverycontactname: e.target.value }))} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t.packing.address}</label>
                <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliveryaddress} onChange={(e) => setAddressForm((f) => ({ ...f, deliveryaddress: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <div className="w-1/3">
                  <label className="text-xs text-muted-foreground">{t.packing.zipCode}</label>
                  <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliveryzipcode} onChange={(e) => setAddressForm((f) => ({ ...f, deliveryzipcode: e.target.value }))} />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">{t.packing.city}</label>
                  <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliverycity} onChange={(e) => setAddressForm((f) => ({ ...f, deliverycity: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t.packing.country}</label>
                <input className="w-full px-3 py-2 min-h-[44px] text-sm border border-border rounded-lg bg-background" value={addressForm.deliverycountry} onChange={(e) => setAddressForm((f) => ({ ...f, deliverycountry: e.target.value }))} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
              <button onClick={() => setEditingAddress(false)} disabled={addressSaving} className="px-4 py-2 min-h-[44px] text-sm rounded-lg hover:bg-muted transition-colors">
                {t.common.cancel}
              </button>
              <button onClick={saveAddress} disabled={addressSaving} className="px-4 py-2 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50">
                {addressSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Close picklist confirmation */}
      {showClosePicklistConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowClosePicklistConfirm(false)}>
          <div className="bg-card rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">{t.packing.closePicklistTitle}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {t.packing.closePicklistConfirm}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowClosePicklistConfirm(false)}
                className="px-4 py-2 min-h-[44px] text-sm rounded-lg hover:bg-muted transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleClosePicklist}
                disabled={isClosingPicklist}
                className="px-4 py-2 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isClosingPicklist ? t.common.loading : t.common.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shipment Progress Modal */}
      <ShipmentProgress
        boxes={shipmentModalBoxId
          ? session.boxes.filter((b) => b.id === shipmentModalBoxId)
          : session.boxes.filter((b) => b.status !== 'cancelled')
        }
        shipProgress={shipProgress}
        isOpen={showShipmentModal}
        onClose={() => { setShowShipmentModal(false); setShipmentModalBoxId(null) }}
        onShipAll={handleShipAll}
        onRetryBox={handleRetryBox}
        picklistId={session.picklistId}
        sessionId={sessionId}
        defaultShippingProviderId={shippingProviderId}
        boxWeights={boxWeights}
        onNextPicklist={nextPicklistInBatch ? () => handleBatchNavigate(nextPicklistInBatch) : undefined}
        hasNextPicklist={!!nextPicklistInBatch}
        isBatchCompleted={isBatchCompleted}
        onBackToBatches={isBatchCompleted && !nextPicklistInBatch ? onBack : undefined}
        defaultWeight={picklist?.weight ?? undefined}
        hasPackingStation={!!packingStationId}
        activeBoxId={shipmentModalBoxId}
      />

      {/* Quantity picker modal */}
      {quantityPickerState && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setQuantityPickerState(null)}>
          <div className="bg-card rounded-xl shadow-xl p-6 mx-4 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-1">{t.packing.howMany}</h3>
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
              {t.common.cancel}
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
  const { t } = useTranslation()
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
        setSendError(result.error || t.packing.commentSendFailed)
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
        setSendError(result.error || t.packing.commentDeleteFailed)
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
          {t.comments.title}
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
          {t.packing.loadingComments}
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
                    {t.comments.reply}
                  </button>
                  {isOwnComment(comment.authorName) && (
                    <button
                      onClick={() => handleDelete(comment.idcomment)}
                      disabled={deletingId === comment.idcomment}
                      className="px-2 py-0.5 text-xs border border-border rounded hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {deletingId === comment.idcomment ? t.common.loading : t.common.delete}
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
          {t.comments.noComments}
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
            placeholder={t.packing.commentPlaceholder}
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
