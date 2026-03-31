'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, ArrowLeft, RefreshCw, CheckCircle2, ChevronDown, ChevronRight, ScanBarcode, X, ChevronLeft, Plus, Clock } from 'lucide-react'
import Link from 'next/link'
import BarcodeListener from '@/components/verpakking/BarcodeListener'
import type { RaapSessionItem, RaapSession } from '@/lib/supabase/raapSessions'
import type { PickListAllocation } from '@/lib/raapmodule/pickListBuilder'

/** Extended item with enrichment data (not persisted to DB) */
interface EnrichedItem extends RaapSessionItem {
  image?: string | null
  allocations?: PickListAllocation[]
}

interface BatchGroup {
  batch_id: number
  batch_name: string
  items: EnrichedItem[]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins} min geleden`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} uur geleden`
  const days = Math.floor(hours / 24)
  return `${days} dag${days > 1 ? 'en' : ''} geleden`
}

function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const onScanRef = useRef(onScan)
  const onCloseRef = useRef(onClose)
  onScanRef.current = onScan
  onCloseRef.current = onClose

  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrCodeRef = useRef<unknown>(null)

  useEffect(() => {
    let mounted = true

    async function start() {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
      if (!mounted || !scannerRef.current) return

      const scanner = new Html5Qrcode('raap-camera-scanner', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      })
      html5QrCodeRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
            const w = Math.floor(viewfinderWidth * 0.8)
            const h = Math.floor(Math.min(viewfinderHeight * 0.3, 200))
            return { width: w, height: h }
          }},
          (decodedText: string) => { onScanRef.current(decodedText) },
          () => {}
        )
      } catch (err) {
        console.error('Camera scanner failed:', err)
        onCloseRef.current()
      }
    }

    start()

    return () => {
      mounted = false
      const scanner = html5QrCodeRef.current as { stop?: () => Promise<void>; clear?: () => void } | null
      if (scanner?.stop) {
        scanner.stop().then(() => scanner.clear?.()).catch(() => {})
      }
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between p-4">
        <span className="text-white font-medium">Scan barcode</span>
        <button onClick={onClose} className="p-2 text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div id="raap-camera-scanner" ref={scannerRef} className="w-full h-full" />
      </div>
    </div>
  )
}

function ProductDetailSheet({
  item,
  onClose,
  onPrev,
  onNext,
  onToggleCheck,
  onOpenScanner,
}: {
  item: EnrichedItem
  onClose: () => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  onToggleCheck: () => void
  onOpenScanner: () => void
}) {
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

  return (
    <div className="fixed inset-0 z-40 flex flex-col" onClick={onClose}>
      <div className="flex-1 bg-black/40" />
      <div
        className="bg-background rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-4 p-4 border-b border-border">
          {item.image ? (
            <img src={item.image} alt={item.product_name} className="w-16 h-16 rounded-lg object-cover flex-shrink-0 bg-muted" />
          ) : (
            <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <span className="text-muted-foreground text-xs">Geen foto</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-lg leading-tight">{item.productcode}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{item.product_name}</p>
          </div>
          <button onClick={onOpenScanner} className="p-1.5 hover:bg-muted rounded-md transition-colors flex-shrink-0">
            <ScanBarcode className="w-5 h-5" />
          </button>
          <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-md transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-4 space-y-5">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5">Locatie</p>
            <span className="inline-block px-2.5 py-1 bg-muted rounded-md text-sm font-medium">{item.location}</span>
          </div>

          {item.allocations && item.allocations.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">Picklijsten</p>
              <div className="space-y-0 divide-y divide-border border border-border rounded-lg">
                {item.allocations.map((alloc, i) => (
                  <div key={alloc.picklist_id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{alloc.picklistid}</p>
                      <p className="text-xs text-muted-foreground truncate">{alloc.delivery_name}</p>
                      {alloc.plantnummer && (
                        <p className="text-xs text-blue-600 font-medium mt-0.5">#{alloc.plantnummer}</p>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">{alloc.qty}&times;</span>
                    <span className="w-8 h-8 flex items-center justify-center border border-border rounded-md text-sm font-medium">
                      {LETTERS[i] || i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1.5">Totaal te rapen</p>
            <p className="text-2xl font-bold">{item.qty_needed}</p>
          </div>

          <button
            onClick={onToggleCheck}
            className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${
              item.checked ? 'bg-muted text-muted-foreground hover:bg-muted/80' : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {item.checked ? 'Markering ongedaan maken' : 'Markeer als geraapt'}
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <button onClick={onPrev ?? undefined} disabled={!onPrev} className="p-2 hover:bg-muted rounded-md transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button onClick={onNext ?? undefined} disabled={!onNext} className="p-2 hover:bg-muted rounded-md transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function KamerplantenClient() {
  const [session, setSession] = useState<RaapSession | null>(null)
  const [items, setItems] = useState<EnrichedItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set())
  const [showCamera, setShowCamera] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getItemKey = (item: EnrichedItem) => `${item.product_id}::${item.location}::${item.batch_id}`

  // Check for active session on mount
  const checkSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/raapmodule/sessions?category=kamerplanten')
      const { session: activeSession } = await res.json()
      if (activeSession) {
        setSession(activeSession)
        // Load saved items + fresh data from Picqer in parallel
        const [itemsRes, pickRes] = await Promise.all([
          fetch(`/api/raapmodule/sessions/${activeSession.id}/items`),
          fetch('/api/raapmodule/products/kamerplanten?group_by=batch'),
        ])
        const { items: savedItems } = await itemsRes.json()
        const { items: freshItems } = await pickRes.json()

        // Merge: use fresh data (with images/allocations) but preserve checked state from saved
        const checkedKeys = new Set(
          (savedItems || []).filter((i: RaapSessionItem) => i.checked).map((i: RaapSessionItem) => `${i.product_id}::${i.location}::${i.batch_id}`)
        )
        const mergedItems = (freshItems || []).map((item: EnrichedItem) => ({
          ...item,
          checked: checkedKeys.has(`${item.product_id}::${item.location}::${item.batch_id}`),
          qty_picked: checkedKeys.has(`${item.product_id}::${item.location}::${item.batch_id}`) ? item.qty_needed : 0,
        }))

        if (mergedItems.length > 0) {
          await fetch(`/api/raapmodule/sessions/${activeSession.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: mergedItems }),
          })
        }
        setItems(mergedItems)
      } else {
        setSession(null)
        setItems([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { checkSession() }, [checkSession])

  // Start a new session
  const startNewSession = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const createRes = await fetch('/api/raapmodule/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'kamerplanten' }),
      })
      const createData = await createRes.json()
      if (!createRes.ok || !createData.session) {
        throw new Error(createData.error || 'Sessie aanmaken mislukt')
      }
      setSession(createData.session)

      const pickRes = await fetch('/api/raapmodule/products/kamerplanten?group_by=batch')
      const { items: pickItems } = await pickRes.json()

      if (pickItems?.length > 0) {
        await fetch(`/api/raapmodule/sessions/${createData.session.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: pickItems }),
        })
      }
      setItems(pickItems || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Refresh items within current session (re-fetch from Picqer, preserve checked state)
  const refreshItems = useCallback(async () => {
    if (!session) return
    setIsRefreshing(true)
    try {
      const pickRes = await fetch('/api/raapmodule/products/kamerplanten?group_by=batch')
      const { items: freshItems } = await pickRes.json()

      const checkedKeys = new Set(
        items.filter(i => i.checked).map(i => getItemKey(i))
      )
      const mergedItems = (freshItems || []).map((item: EnrichedItem) => ({
        ...item,
        checked: checkedKeys.has(`${item.product_id}::${item.location}::${item.batch_id}`),
        qty_picked: checkedKeys.has(`${item.product_id}::${item.location}::${item.batch_id}`) ? item.qty_needed : 0,
      }))

      if (mergedItems.length > 0) {
        await fetch(`/api/raapmodule/sessions/${session.id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: mergedItems }),
        })
      }
      setItems(mergedItems)
    } finally {
      setIsRefreshing(false)
    }
  }, [session, items])

  // Complete session
  const handleComplete = async () => {
    if (!session) return
    await fetch(`/api/raapmodule/sessions/${session.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    setSession(null)
    setItems([])
    setExpandedBatches(new Set())
  }

  const batchGroups = useMemo((): BatchGroup[] => {
    const groups = new Map<number, BatchGroup>()
    for (const item of items) {
      const batchId = item.batch_id ?? 0
      if (!groups.has(batchId)) {
        groups.set(batchId, { batch_id: batchId, batch_name: item.batch_name || `Batch ${batchId}`, items: [] })
      }
      groups.get(batchId)!.items.push(item)
    }
    return Array.from(groups.values())
  }, [items])

  const flatItems = useMemo(() => {
    const result: EnrichedItem[] = []
    for (const group of batchGroups) result.push(...group.items)
    return result
  }, [batchGroups])

  const toggleBatch = (batchId: number) => {
    setExpandedBatches(prev => {
      const next = new Set(prev)
      if (next.has(batchId)) next.delete(batchId)
      else next.add(batchId)
      return next
    })
  }

  const showFeedback = useCallback((message: string, type: 'success' | 'error') => {
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current)
    setScanFeedback({ message, type })
    feedbackTimeoutRef.current = setTimeout(() => setScanFeedback(null), 2000)
  }, [])

  const saveItems = useCallback(async (updatedItems: EnrichedItem[]) => {
    if (!session) return
    setItems(updatedItems)
    setIsSaving(true)
    await fetch(`/api/raapmodule/sessions/${session.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: updatedItems }),
    })
    setIsSaving(false)
  }, [session])

  const toggleCheck = useCallback(async (targetKey: string) => {
    const updatedItems = items.map(item => {
      if (getItemKey(item) !== targetKey) return item
      const nowChecked = !item.checked
      return { ...item, checked: nowChecked, qty_picked: nowChecked ? item.qty_needed : 0 }
    })
    await saveItems(updatedItems)
  }, [items, saveItems])

  const checkItem = useCallback(async (targetKey: string) => {
    const updatedItems = items.map(item => {
      if (getItemKey(item) !== targetKey) return item
      return { ...item, checked: true, qty_picked: item.qty_needed }
    })
    await saveItems(updatedItems)
  }, [items, saveItems])

  const matchAndCheck = useCallback((productcode: string) => {
    const match = items.find(i => !i.checked && i.productcode === productcode)
    if (match) {
      checkItem(getItemKey(match))
      if (match.batch_id !== null) setExpandedBatches(prev => new Set([...prev, match.batch_id!]))
      showFeedback(`${match.product_name}`, 'success')
      return true
    }
    const allForCode = items.filter(i => i.productcode === productcode)
    if (allForCode.length > 0 && allForCode.every(i => i.checked)) {
      showFeedback('Al geraapt', 'error')
      return true
    }
    return false
  }, [items, checkItem, showFeedback])

  const handleScan = useCallback(async (barcode: string) => {
    if (matchAndCheck(barcode)) return
    try {
      const res = await fetch(`/api/raapmodule/barcode-lookup?barcode=${encodeURIComponent(barcode)}`)
      const { productcode } = await res.json()
      if (productcode && matchAndCheck(productcode)) return
    } catch { /* ignore */ }
    showFeedback(`Niet gevonden: ${barcode}`, 'error')
  }, [matchAndCheck, showFeedback])

  // Detail sheet navigation
  const selectedItem = useMemo(() => {
    if (!selectedItemKey) return null
    return items.find(i => getItemKey(i) === selectedItemKey) ?? null
  }, [selectedItemKey, items])

  const selectedIndex = useMemo(() => {
    if (!selectedItemKey) return -1
    return flatItems.findIndex(i => getItemKey(i) === selectedItemKey)
  }, [selectedItemKey, flatItems])

  const handlePrev = selectedIndex > 0 ? () => {
    const prev = flatItems[selectedIndex - 1]
    setSelectedItemKey(getItemKey(prev))
    if (prev.batch_id !== null) setExpandedBatches(p => new Set([...p, prev.batch_id!]))
  } : null

  const handleNext = selectedIndex < flatItems.length - 1 ? () => {
    const next = flatItems[selectedIndex + 1]
    setSelectedItemKey(getItemKey(next))
    if (next.batch_id !== null) setExpandedBatches(p => new Set([...p, next.batch_id!]))
  } : null

  const checkedCount = items.filter(i => i.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length

  // --- LOADING ---
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // --- ERROR ---
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-destructive font-medium mb-2">Fout bij laden</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button onClick={checkSession} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Opnieuw proberen
          </button>
        </div>
      </div>
    )
  }

  // --- NO ACTIVE SESSION ---
  if (!session) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h2 className="text-xl font-bold">Kamerplanten</h2>
          </div>

          <div className="border border-border rounded-lg p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Plus className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-lg mb-1">Geen actieve sessie</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Start een nieuwe sessie om kamerplanten te rapen. De lijst wordt opgehaald uit Picqer.
            </p>
            <button
              onClick={startNewSession}
              className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Nieuwe sessie starten
            </button>
          </div>
        </div>
      </div>
    )
  }

  // --- ACTIVE SESSION ---
  return (
    <div className="flex-1 p-6">
      <BarcodeListener onScan={handleScan} enabled={!isLoading && !showCamera && !selectedItem} />

      {showCamera && <CameraScanner onScan={handleScan} onClose={() => setShowCamera(false)} />}

      {scanFeedback && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
          scanFeedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-500'
        }`}>
          {scanFeedback.message}
        </div>
      )}

      {selectedItem && (
        <ProductDetailSheet
          item={selectedItem}
          onClose={() => setSelectedItemKey(null)}
          onPrev={handlePrev}
          onNext={handleNext}
          onToggleCheck={() => toggleCheck(getItemKey(selectedItem))}
          onOpenScanner={() => { setSelectedItemKey(null); setShowCamera(true) }}
        />
      )}

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Kamerplanten</h2>
          </div>
          <button
            onClick={() => setShowCamera(true)}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
            title="Barcode scannen"
          >
            <ScanBarcode className="w-5 h-5" />
          </button>
        </div>

        {/* Session info bar */}
        <div className="flex items-center gap-3 mb-6 px-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>Gestart {timeAgo(session.created_at)}</span>
          </div>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {checkedCount} / {items.length} geraapt
          </span>
          {isSaving && <span className="text-xs text-muted-foreground">· opslaan...</span>}
          <div className="flex-1" />
          <button
            onClick={refreshItems}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Lijst vernieuwen vanuit Picqer"
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Vernieuwen</span>
          </button>
        </div>

        {/* Progress bar */}
        {items.length > 0 && (
          <div className="h-1.5 bg-muted rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300"
              style={{ width: `${(checkedCount / items.length) * 100}%` }}
            />
          </div>
        )}

        {/* Batch list */}
        {batchGroups.length === 0 ? (
          <div className="border border-border rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
            Geen kamerplanten te rapen
          </div>
        ) : (
          <div className="space-y-3">
            {batchGroups.map(group => {
              const isExpanded = expandedBatches.has(group.batch_id)
              const groupChecked = group.items.filter(i => i.checked).length
              const groupTotal = group.items.length
              const allGroupChecked = groupChecked === groupTotal

              return (
                <div key={group.batch_id} className="border border-border rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleBatch(group.batch_id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      allGroupChecked ? 'bg-emerald-50' : 'hover:bg-muted/30'
                    }`}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    }
                    <span className={`font-medium flex-1 ${allGroupChecked ? 'text-muted-foreground line-through' : ''}`}>
                      {group.batch_name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {groupChecked} / {groupTotal}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-border">
                      {group.items.map(item => {
                        const key = getItemKey(item)
                        return (
                          <div
                            key={key}
                            onClick={() => setSelectedItemKey(key)}
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                              item.checked ? 'bg-emerald-50 text-muted-foreground' : 'hover:bg-muted/30'
                            }`}
                          >
                            <div onClick={e => { e.stopPropagation(); toggleCheck(key) }}>
                              <input type="checkbox" checked={item.checked} readOnly className="w-4 h-4 rounded pointer-events-none" />
                            </div>

                            {item.image ? (
                              <img src={item.image} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0 bg-muted" />
                            ) : (
                              <div className="w-10 h-10 rounded bg-muted flex-shrink-0" />
                            )}

                            <div className="flex-1 min-w-0">
                              <div className={`font-medium text-sm ${item.checked ? 'line-through' : ''}`}>{item.product_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {item.productcode}
                                {item.allocations?.some(a => a.plantnummer) && (
                                  <span className="text-blue-600 font-medium ml-1.5">
                                    #{item.allocations.filter(a => a.plantnummer).map(a => a.plantnummer).join(', #')}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {item.location && (
                                <span className="px-1.5 py-0.5 bg-muted rounded text-[10px] font-medium">{item.location}</span>
                              )}
                              <span className="font-semibold text-sm w-6 text-right">{item.qty_needed}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-3 mt-6">
          {allChecked && (
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Sessie afronden
            </button>
          )}
          <button
            onClick={handleComplete}
            className="text-xs text-muted-foreground hover:text-destructive transition-colors ml-auto"
          >
            Sessie stoppen
          </button>
        </div>
      </div>
    </div>
  )
}
