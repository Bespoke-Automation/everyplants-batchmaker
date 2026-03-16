'use client'

import { useState, useEffect, useCallback } from 'react'
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

export default function BuitenplantenClient() {
  const [items, setItems] = useState<PickItem[]>([])
  const [pickedItems, setPickedItems] = useState<PickedItem[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [pickRes, pickedRes] = await Promise.all([
        fetch('/api/raapmodule/products/buitenplanten'),
        fetch('/api/raapmodule/picked-items'),
      ])
      const { items: pickItems } = await pickRes.json()
      const { items: picked } = await pickedRes.json()
      setItems(pickItems || [])
      setPickedItems(picked || [])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

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
          qty_picked: item.qty_needed,
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

  return (
    <div className="flex-1 p-6">
      <div className="max-w-4xl mx-auto">
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
                <th className="text-right px-4 py-3 font-medium">Aantal</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Batches</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Geen buitenplanten te rapen
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const key = `${item.product_id}::${item.location}`
                  const isChecked = checked.has(key)
                  const isPicked = pickedKeys.has(key)
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
                      <td className="px-4 py-2.5 text-right font-semibold">{item.qty_needed}</td>
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
