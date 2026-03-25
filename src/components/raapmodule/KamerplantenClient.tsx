'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Loader2, ArrowLeft, RefreshCw, CheckCircle2, ChevronDown, ChevronRight, ScanBarcode, X } from 'lucide-react'
import Link from 'next/link'
import BarcodeListener from '@/components/verpakking/BarcodeListener'
import type { RaapSessionItem } from '@/lib/supabase/raapSessions'

interface BatchGroup {
  batch_id: number
  batch_name: string
  items: RaapSessionItem[]
}

function CameraScanner({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const scannerRef = useRef<HTMLDivElement>(null)
  const html5QrCodeRef = useRef<unknown>(null)

  useEffect(() => {
    let mounted = true

    async function start() {
      const { Html5Qrcode } = await import('html5-qrcode')
      if (!mounted || !scannerRef.current) return

      const scanner = new Html5Qrcode('raap-camera-scanner')
      html5QrCodeRef.current = scanner

      try {
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 280, height: 120 } },
          (decodedText) => {
            onScan(decodedText)
          },
          () => {} // ignore errors (no code found in frame)
        )
      } catch {
        // Camera permission denied or not available
        onClose()
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
  }, [onScan, onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center justify-between p-4">
        <span className="text-white font-medium">Scan barcode</span>
        <button onClick={onClose} className="p-2 text-white">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <div id="raap-camera-scanner" ref={scannerRef} className="w-full max-w-sm rounded-lg overflow-hidden" />
      </div>
    </div>
  )
}

export default function KamerplantenClient() {
  const [items, setItems] = useState<RaapSessionItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedBatches, setExpandedBatches] = useState<Set<number>>(new Set())
  const [showCamera, setShowCamera] = useState(false)
  const [scanFeedback, setScanFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (forceNew = false) => {
    setIsLoading(true)
    setError(null)
    try {
      let session = null

      if (!forceNew) {
        const activeRes = await fetch(`/api/raapmodule/sessions?category=kamerplanten`)
        const { session: activeSession } = await activeRes.json()
        session = activeSession
      }

      if (session) {
        setSessionId(session.id)
        const [itemsRes, pickRes] = await Promise.all([
          fetch(`/api/raapmodule/sessions/${session.id}/items`),
          fetch(`/api/raapmodule/products/kamerplanten?group_by=batch`),
        ])
        const { items: existingItems } = await itemsRes.json()
        const { items: freshItems } = await pickRes.json()

        const checkedKeys = new Set(
          (existingItems || []).filter((i: RaapSessionItem) => i.checked).map((i: RaapSessionItem) => `${i.product_id}::${i.location}::${i.batch_id}`)
        )
        const mergedItems = (freshItems || []).map((item: RaapSessionItem) => ({
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
      } else {
        const createRes = await fetch('/api/raapmodule/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category: 'kamerplanten' }),
        })
        const createData = await createRes.json()
        if (!createRes.ok || !createData.session) {
          throw new Error(createData.error || 'Sessie aanmaken mislukt')
        }
        const newSession = createData.session
        setSessionId(newSession.id)

        const pickRes = await fetch(`/api/raapmodule/products/kamerplanten?group_by=batch`)
        const { items: pickItems } = await pickRes.json()

        if (pickItems?.length > 0) {
          await fetch(`/api/raapmodule/sessions/${newSession.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: pickItems }),
          })
        }
        setItems(pickItems || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const batchGroups = useMemo((): BatchGroup[] => {
    const groups = new Map<number, BatchGroup>()
    for (const item of items) {
      const batchId = item.batch_id ?? 0
      if (!groups.has(batchId)) {
        groups.set(batchId, {
          batch_id: batchId,
          batch_name: item.batch_name || `Batch ${batchId}`,
          items: [],
        })
      }
      groups.get(batchId)!.items.push(item)
    }
    return Array.from(groups.values())
  }, [items])

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

  const checkItem = useCallback(async (productId: number, location: string, batchId: number | null) => {
    if (!sessionId) return
    const key = `${productId}::${location}::${batchId}`
    const updatedItems = items.map(item => {
      if (`${item.product_id}::${item.location}::${item.batch_id}` !== key) return item
      return { ...item, checked: true, qty_picked: item.qty_needed }
    })
    setItems(updatedItems)

    await fetch(`/api/raapmodule/sessions/${sessionId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: updatedItems }),
    })
  }, [sessionId, items])

  const toggleCheck = async (productId: number, location: string, batchId: number | null) => {
    if (!sessionId || isSaving) return
    const key = `${productId}::${location}::${batchId}`
    const updatedItems = items.map(item => {
      if (`${item.product_id}::${item.location}::${item.batch_id}` !== key) return item
      const nowChecked = !item.checked
      return { ...item, checked: nowChecked, qty_picked: nowChecked ? item.qty_needed : 0 }
    })
    setItems(updatedItems)

    setIsSaving(true)
    await fetch(`/api/raapmodule/sessions/${sessionId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: updatedItems }),
    })
    setIsSaving(false)
  }

  const handleScan = useCallback((barcode: string) => {
    // Find first unchecked item matching this productcode
    const match = items.find(i => !i.checked && i.productcode === barcode)
    if (match) {
      checkItem(match.product_id, match.location, match.batch_id)
      // Auto-expand the batch containing the matched item
      if (match.batch_id !== null) {
        setExpandedBatches(prev => new Set([...prev, match.batch_id!]))
      }
      showFeedback(`${match.product_name}`, 'success')
    } else {
      // Check if already all checked for this barcode
      const allChecked = items.filter(i => i.productcode === barcode)
      if (allChecked.length > 0 && allChecked.every(i => i.checked)) {
        showFeedback('Al geraapt', 'error')
      } else {
        showFeedback(`Niet gevonden: ${barcode}`, 'error')
      }
    }
  }, [items, checkItem, showFeedback])

  const handleComplete = async () => {
    if (!sessionId) return
    await fetch(`/api/raapmodule/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    load(true)
  }

  const checkedCount = items.filter(i => i.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-destructive font-medium mb-2">Fout bij laden</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button
            onClick={() => load(false)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Opnieuw proberen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6">
      <BarcodeListener onScan={handleScan} enabled={!isLoading && !showCamera} />

      {showCamera && (
        <CameraScanner onScan={handleScan} onClose={() => setShowCamera(false)} />
      )}

      {/* Scan feedback toast */}
      {scanFeedback && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
          scanFeedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-500'
        }`}>
          {scanFeedback.message}
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Kamerplanten</h2>
            <p className="text-sm text-muted-foreground">
              {checkedCount} / {items.length} geraapt · {batchGroups.length} batch{batchGroups.length !== 1 ? 'es' : ''}
              {isSaving && ' · opslaan...'}
            </p>
          </div>
          <button
            onClick={() => setShowCamera(true)}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
            title="Barcode scannen"
          >
            <ScanBarcode className="w-5 h-5" />
          </button>
          <button
            onClick={() => load(true)}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
            title="Nieuwe sessie starten"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {allChecked && (
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
              Sessie afronden
            </button>
          )}
        </div>

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
                    <table className="w-full text-sm">
                      <tbody>
                        {group.items.map(item => {
                          const key = `${item.product_id}::${item.location}::${item.batch_id}`
                          return (
                            <tr
                              key={key}
                              onClick={() => toggleCheck(item.product_id, item.location, item.batch_id)}
                              className={`border-t border-border cursor-pointer transition-colors ${
                                item.checked
                                  ? 'bg-emerald-50 text-muted-foreground'
                                  : 'hover:bg-muted/30'
                              }`}
                            >
                              <td className="w-10 px-4 py-3" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={item.checked}
                                  onChange={() => toggleCheck(item.product_id, item.location, item.batch_id)}
                                  className="w-4 h-4 rounded"
                                />
                              </td>
                              <td className="px-4 py-2.5">
                                <div className={`font-medium ${item.checked ? 'line-through' : ''}`}>
                                  {item.product_name}
                                </div>
                                <div className="text-xs text-muted-foreground">{item.productcode}</div>
                              </td>
                              <td className="px-4 py-2.5 font-mono text-xs">{item.location}</td>
                              <td className="px-4 py-2.5 text-right font-semibold">{item.qty_needed}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
