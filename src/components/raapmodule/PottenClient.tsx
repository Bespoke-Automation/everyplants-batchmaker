'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import type { Vervoerder } from '@/lib/supabase/vervoerders'
import type { RaapSessionItem } from '@/lib/supabase/raapSessions'

interface VervoerderOption {
  id: string
  name: string
  profileCount: number
}

/** Combine DPD and PostNL into a single option for Potten */
function buildVervoerderOptions(vervoerders: Vervoerder[]): VervoerderOption[] {
  const dpd = vervoerders.find(v => v.name === 'DPD')
  const postnl = vervoerders.find(v => v.name === 'PostNL')
  const others = vervoerders.filter(v => v.name !== 'DPD' && v.name !== 'PostNL')

  const options: VervoerderOption[] = others.map(v => ({
    id: v.id,
    name: v.name,
    profileCount: v.profiles.length,
  }))

  if (dpd && postnl) {
    options.push({
      id: `${dpd.id},${postnl.id}`,
      name: 'DPD/PostNL',
      profileCount: dpd.profiles.length + postnl.profiles.length,
    })
  } else if (dpd) {
    options.push({ id: dpd.id, name: dpd.name, profileCount: dpd.profiles.length })
  } else if (postnl) {
    options.push({ id: postnl.id, name: postnl.name, profileCount: postnl.profiles.length })
  }

  return options.sort((a, b) => a.name.localeCompare(b.name))
}

export default function PottenClient() {
  const [vervoerders, setVervoerders] = useState<Vervoerder[]>([])
  const [isLoadingVervoerders, setIsLoadingVervoerders] = useState(true)
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)
  const [items, setItems] = useState<RaapSessionItem[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/raapmodule/vervoerders')
      .then(r => r.json())
      .then(data => setVervoerders(data.vervoerders || []))
      .catch(console.error)
      .finally(() => setIsLoadingVervoerders(false))
  }, [])

  const options = buildVervoerderOptions(vervoerders)

  const loadPickList = useCallback(async (optionId: string, forceNew = false) => {
    setIsLoadingItems(true)
    setLoadError(null)
    setItems([])
    // Use first vervoerder ID for session storage, full ID string for product fetching
    const primaryVervoerderId = optionId.split(',')[0]
    try {
      let session = null

      if (!forceNew) {
        const activeRes = await fetch(
          `/api/raapmodule/sessions?category=potten&vervoerder_id=${primaryVervoerderId}`
        )
        const { session: activeSession } = await activeRes.json()
        session = activeSession
      }

      if (session) {
        // Resume: load checked state, then refresh with fresh data
        setSessionId(session.id)
        const [itemsRes, pickRes] = await Promise.all([
          fetch(`/api/raapmodule/sessions/${session.id}/items`),
          fetch(`/api/raapmodule/products/potten?vervoerder_id=${optionId}`),
        ])
        const { items: existingItems } = await itemsRes.json()
        const { items: freshItems } = await pickRes.json()

        // Preserve checked state from existing session
        const checkedKeys = new Set(
          (existingItems || []).filter((i: RaapSessionItem) => i.checked).map((i: RaapSessionItem) => `${i.product_id}::${i.location}`)
        )
        const mergedItems = (freshItems || []).map((item: RaapSessionItem) => ({
          ...item,
          checked: checkedKeys.has(`${item.product_id}::${item.location}`),
          qty_picked: checkedKeys.has(`${item.product_id}::${item.location}`) ? item.qty_needed : 0,
        }))

        // Persist merged items to session
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
          body: JSON.stringify({ category: 'potten', vervoerder_id: primaryVervoerderId }),
        })
        const createData = await createRes.json()
        if (!createRes.ok || !createData.session) {
          throw new Error(createData.error || 'Sessie aanmaken mislukt')
        }
        const newSession = createData.session
        setSessionId(newSession.id)

        const pickRes = await fetch(
          `/api/raapmodule/products/potten?vervoerder_id=${optionId}`
        )
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
      setLoadError(err instanceof Error ? err.message : 'Er is een fout opgetreden')
    } finally {
      setIsLoadingItems(false)
    }
  }, [])

  const handleSelectOption = (id: string) => {
    setSelectedOptionId(id)
    loadPickList(id)
  }

  const toggleCheck = async (productId: number, location: string) => {
    if (!sessionId || isSaving) return
    const key = `${productId}::${location}`
    const updatedItems = items.map(item => {
      if (`${item.product_id}::${item.location}` !== key) return item
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
    if (!sessionId || !selectedOptionId) return
    await fetch(`/api/raapmodule/sessions/${sessionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    })
    setSelectedOptionId(null)
    setItems([])
    setSessionId(null)
  }

  // Vervoerder selection screen
  if (!selectedOptionId) {
    return (
      <div className="flex-1 p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <Link href="/raapmodule" className="p-1.5 hover:bg-muted rounded-md transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h2 className="text-xl font-bold">Potten</h2>
              <p className="text-sm text-muted-foreground">Kies een vervoerder</p>
            </div>
          </div>

          {isLoadingVervoerders ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-3">
              {options.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => handleSelectOption(opt.id)}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:border-primary hover:bg-muted/30 transition-all text-left"
                >
                  <span className="font-medium">{opt.name}</span>
                  <span className="text-sm text-muted-foreground">{opt.profileCount} profiel(en)</span>
                </button>
              ))}
              {options.length === 0 && (
                <p className="text-center py-8 text-muted-foreground text-sm">
                  Geen vervoerders geconfigureerd.{' '}
                  <Link href="/batchmaker/settings" className="underline">
                    Stel ze in via Batchmaker instellingen.
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Pick list screen
  const selectedOption = options.find(o => o.id === selectedOptionId)
  const checkedCount = items.filter(i => i.checked).length
  const allChecked = items.length > 0 && checkedCount === items.length

  return (
    <div className="flex-1 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => { setSelectedOptionId(null); setItems([]); setSessionId(null) }}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold">Potten — {selectedOption?.name}</h2>
            <p className="text-sm text-muted-foreground">
              {checkedCount} / {items.length} geraapt
              {isSaving && ' · opslaan...'}
            </p>
          </div>
          <button
            onClick={() => loadPickList(selectedOptionId!, true)}
            className="p-1.5 hover:bg-muted rounded-md transition-colors"
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

        {isLoadingItems ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? (
          <div className="text-center py-12">
            <p className="text-destructive font-medium mb-2">Fout bij laden</p>
            <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
            <button
              onClick={() => loadPickList(selectedOptionId!, false)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Opnieuw proberen
            </button>
          </div>
        ) : (
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
                      Geen potten te rapen voor deze vervoerder
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
        )}
      </div>
    </div>
  )
}
