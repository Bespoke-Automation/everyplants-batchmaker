'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Save, Loader2, ArrowLeft, RefreshCw } from 'lucide-react'
import Link from 'next/link'

interface PickItem {
  product_id: number
  productcode: string
  product_name: string
  location: string
  qty_needed: number
  batch_ids: number[]
  picklist_ids: number[]
}

interface PickedItem {
  product_id: number
  location: string
}

interface Adjustment {
  voorraad_bb: number
  single_orders: number
}

export default function BuitenplantenClient() {
  const [items, setItems] = useState<PickItem[]>([])
  const [pickedItems, setPickedItems] = useState<PickedItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [adjustments, setAdjustments] = useState<Record<string, Adjustment>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const saveTimers = useRef<Record<string, NodeJS.Timeout>>({})

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [pickRes, pickedRes, adjRes] = await Promise.all([
        fetch('/api/raapmodule/products/buitenplanten'),
        fetch('/api/raapmodule/picked-items'),
        fetch('/api/raapmodule/buitenplanten-adjustments'),
      ])
      if (!pickRes.ok) {
        const errData = await pickRes.json().catch(() => ({}))
        throw new Error(errData.error || `Products API error: ${pickRes.status}`)
      }
      const { items: pickItems } = await pickRes.json()
      const { items: picked } = await pickedRes.json()
      const { adjustments: adjData } = await adjRes.json()

      setItems(pickItems || [])
      setPickedItems(picked || [])

      // Build adjustments map keyed by product_id::location
      const adjMap: Record<string, Adjustment> = {}
      for (const adj of adjData || []) {
        adjMap[`${adj.product_id}::${adj.location}`] = {
          voorraad_bb: adj.voorraad_bb,
          single_orders: adj.single_orders,
        }
      }
      setAdjustments(adjMap)
    } catch (err) {
      console.error('Buitenplanten load error:', err)
      setError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout)
    }
  }, [])

  const getAdjustment = (key: string): Adjustment => {
    return adjustments[key] || { voorraad_bb: 0, single_orders: 0 }
  }

  const getAdjustedQty = (item: PickItem): number => {
    const adj = getAdjustment(`${item.product_id}::${item.location}`)
    return Math.max(0, item.qty_needed - adj.voorraad_bb + adj.single_orders)
  }

  const saveAdjustment = (key: string, product_id: number, location: string, adj: Adjustment) => {
    // Clear existing timer for this key
    if (saveTimers.current[key]) {
      clearTimeout(saveTimers.current[key])
    }
    // Debounce: save after 300ms of no changes
    saveTimers.current[key] = setTimeout(async () => {
      try {
        await fetch('/api/raapmodule/buitenplanten-adjustments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product_id,
            location,
            voorraad_bb: adj.voorraad_bb,
            single_orders: adj.single_orders,
          }),
        })
      } catch (err) {
        console.error('Failed to save adjustment:', err)
      }
    }, 300)
  }

  const handleAdjustmentChange = (
    product_id: number,
    location: string,
    field: 'voorraad_bb' | 'single_orders',
    value: number
  ) => {
    const key = `${product_id}::${location}`
    const current = getAdjustment(key)
    const updated = { ...current, [field]: value }
    setAdjustments(prev => ({ ...prev, [key]: updated }))
    saveAdjustment(key, product_id, location, updated)
  }

  const toggleCheck = (productId: number, location: string) => {
    const key = `${productId}::${location}`
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage(null)
    try {
      const toSave = items
        .filter(item => checked.has(`${item.product_id}::${item.location}`))
        .map(item => ({
          picklist_batch_id: item.batch_ids[0] ?? 0,
          picklist_id: item.picklist_ids[0] ?? 0,
          product_id: item.product_id,
          productcode: item.productcode,
          product_name: item.product_name,
          location: item.location,
          qty_picked: getAdjustedQty(item),
        }))

      const res = await fetch('/api/raapmodule/picked-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toSave }),
      })

      if (res.ok) {
        setSaveMessage(`${toSave.length} item(s) opgeslagen als geraapt`)
        setChecked(new Set())
        setTimeout(() => setSaveMessage(null), 4000)
        load()
      }
    } finally {
      setIsSaving(false)
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      const res = await fetch('/api/raapmodule/export/buitenplanten')
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `buitenplanten-${new Date().toISOString().slice(0, 10)}.xlsx`
        a.click()
        URL.revokeObjectURL(url)
      }
    } finally {
      setIsDownloading(false)
    }
  }

  const pickedKeys = new Set(pickedItems.map(p => `${p.product_id}::${p.location}`))

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
          <button onClick={load} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Opnieuw proberen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Buitenplanten</h2>
            <p className="text-sm text-muted-foreground">
              {items.length - pickedKeys.size} product(en) te rapen
            </p>
          </div>
          <button onClick={load} className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-50"
          >
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export voor Adam
          </button>
        </div>

        {pickedItems.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            {pickedItems.length} product(en) zijn al geraapt en worden niet getoond in de export.
          </div>
        )}

        <div className="border border-border rounded-lg overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="w-10 px-4 py-3"></th>
                <th className="text-left px-4 py-3 font-medium">Product</th>
                <th className="text-left px-4 py-3 font-medium">Locatie</th>
                <th className="text-right px-4 py-3 font-medium">Voorraad BB</th>
                <th className="text-right px-4 py-3 font-medium">Single Orders</th>
                <th className="text-right px-4 py-3 font-medium">Aantal</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Batches</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    Geen buitenplanten te rapen
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const key = `${item.product_id}::${item.location}`
                  const isChecked = checked.has(key)
                  const isPicked = pickedKeys.has(key)
                  const adj = getAdjustment(key)
                  const adjustedQty = getAdjustedQty(item)
                  return (
                    <tr
                      key={key}
                      className={`border-t border-border ${isPicked ? 'opacity-40' : ''} ${isChecked ? 'bg-emerald-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCheck(item.product_id, item.location)}
                          disabled={isPicked}
                          className="w-4 h-4 rounded"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{item.product_name}</div>
                        <div className="text-xs text-muted-foreground">{item.productcode}</div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{item.location}</td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={adj.voorraad_bb || ''}
                          placeholder="0"
                          onChange={(e) => handleAdjustmentChange(
                            item.product_id,
                            item.location,
                            'voorraad_bb',
                            Math.max(0, parseInt(e.target.value) || 0)
                          )}
                          disabled={isPicked}
                          className="w-16 px-2 py-1 text-right text-sm border border-border rounded-md bg-background disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={adj.single_orders || ''}
                          placeholder="0"
                          onChange={(e) => handleAdjustmentChange(
                            item.product_id,
                            item.location,
                            'single_orders',
                            Math.max(0, parseInt(e.target.value) || 0)
                          )}
                          disabled={isPicked}
                          className="w-16 px-2 py-1 text-right text-sm border border-border rounded-md bg-background disabled:opacity-50"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{adjustedQty}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {item.batch_ids.join(', ')}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {checked.size > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {checked.size} item(s) markeren als geraapt
            </button>
            {saveMessage && (
              <span className="text-sm text-muted-foreground">{saveMessage}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
