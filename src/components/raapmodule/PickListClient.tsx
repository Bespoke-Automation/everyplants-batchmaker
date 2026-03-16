'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import type { RaapCategory } from '@/lib/supabase/raapCategoryLocations'
import type { RaapSessionItem } from '@/lib/supabase/raapSessions'

interface Props {
  category: RaapCategory
  label: string
}

export default function PickListClient({ category, label }: Props) {
  const [items, setItems] = useState<RaapSessionItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async (forceNew = false) => {
    setIsLoading(true)
    try {
      let session = null

      if (!forceNew) {
        // Try to resume existing active session
        const activeRes = await fetch(`/api/raapmodule/sessions?category=${category}`)
        const { session: activeSession } = await activeRes.json()
        session = activeSession
      }

      if (session) {
        // Resume: load existing items
        setSessionId(session.id)
        const itemsRes = await fetch(`/api/raapmodule/sessions/${session.id}/items`)
        const { items: existingItems } = await itemsRes.json()
        setItems(existingItems || [])
      } else {
        // Create new session and build pick list
        const createRes = await fetch('/api/raapmodule/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        })
        const { session: newSession } = await createRes.json()
        setSessionId(newSession.id)

        const pickRes = await fetch(`/api/raapmodule/products/${category}`)
        const { items: pickItems } = await pickRes.json()

        if (pickItems?.length > 0) {
          // Save items to session
          await fetch(`/api/raapmodule/sessions/${newSession.id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: pickItems }),
          })
        }
        setItems(pickItems || [])
      }
    } finally {
      setIsLoading(false)
    }
  }, [category])

  useEffect(() => { load() }, [load])

  const toggleCheck = async (productId: number, location: string) => {
    if (!sessionId) return

    const key = `${productId}::${location}`
    const updatedItems = items.map(item => {
      const itemKey = `${item.product_id}::${item.location}`
      if (itemKey !== key) return item
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

  const handleComplete = async () => {
    if (!sessionId) return
    await fetch(`/api/raapmodule/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    load(true) // Force new session
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

  return (
    <div className="flex-1 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h2 className="text-xl font-bold">{label}</h2>
            <p className="text-sm text-muted-foreground">
              {checkedCount} / {items.length} geraapt
              {isSaving && ' · opslaan...'}
            </p>
          </div>
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

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground">
                <th className="w-10 px-4 py-3"></th>
                <th className="text-left px-4 py-3 font-medium">Product</th>
                <th className="text-left px-4 py-3 font-medium">Locatie</th>
                <th className="text-right px-4 py-3 font-medium">Aantal</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Geen producten te rapen
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const key = `${item.product_id}::${item.location}`
                  return (
                    <tr
                      key={key}
                      onClick={() => toggleCheck(item.product_id, item.location)}
                      className={`border-t border-border cursor-pointer transition-colors ${
                        item.checked
                          ? 'bg-emerald-50 text-muted-foreground'
                          : 'hover:bg-muted/30'
                      }`}
                    >
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={() => toggleCheck(item.product_id, item.location)}
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
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
