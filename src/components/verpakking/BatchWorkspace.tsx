'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import BatchOverview from './BatchOverview'
import VerpakkingsClient, { prefetchCache } from './VerpakkingsClient'
import type { Worker, BatchPicklistItem } from '@/types/verpakking'
import { useTranslation } from '@/i18n/LanguageContext'

interface BatchContextProduct {
  productcode: string
  picklistAllocations: { idpicklist: number; amount: number }[]
}

interface BatchWorkspaceProps {
  batchSessionId: string | null
  previewBatchId: number | null
  worker: Worker
  onBack: () => void
  devMode?: boolean
  onPicklistPreview?: (picklistId: number, displayId: string) => void
  onBatchClaimed?: (batchSessionId: string) => void
  initialView?: 'overview' | 'picklist'
  initialSessionId?: string | null
}

export default function BatchWorkspace({
  batchSessionId,
  previewBatchId,
  worker,
  onBack,
  devMode,
  onPicklistPreview,
  onBatchClaimed,
  initialView = 'overview',
  initialSessionId = null,
}: BatchWorkspaceProps) {
  const { t } = useTranslation()
  const [currentView, setCurrentView] = useState<'overview' | 'picklist'>(initialView)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(initialSessionId)
  const [bulkDataLoaded, setBulkDataLoaded] = useState(false)
  const [isNavCreatingSession, setIsNavCreatingSession] = useState(false)

  // Store batch context for VerpakkingsClient (picklists + products from bulk load)
  const [batchContext, setBatchContext] = useState<{
    batchSessionId: string
    batchDisplayId: string
    picklists: BatchPicklistItem[]
    products?: BatchContextProduct[]
  } | null>(null)

  // Bulk load all picklist data when batch session is available
  useEffect(() => {
    if (!batchSessionId || bulkDataLoaded) return

    let cancelled = false

    async function loadBulkData() {
      try {
        const res = await fetch(`/api/verpakking/batch-workspace/${batchSessionId}`)
        if (!res.ok || cancelled) return

        const data = await res.json()
        const picklistDataMap = data.picklistDataMap ?? {}
        const picqerBatch = data.picqerBatch
        const batchSessionData = data.batchSession

        // Populate VerpakkingsClient's module-level prefetchCache
        const now = Date.now()
        for (const [picklistIdStr, picklistData] of Object.entries(picklistDataMap)) {
          const picklistId = parseInt(picklistIdStr, 10)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pd = picklistData as any
          prefetchCache.set(picklistId, {
            picklist: pd.picklist,
            order: pd.order,
            shippingProfileName: pd.shippingProfileName,
            productCustomFields: pd.productCustomFields,
            fetchedAt: now,
          })
        }

        // Build packing session map for picklist → session mapping
        const sessionMap = new Map<number, { id: string; status: string }>()
        for (const ps of batchSessionData?.packing_sessions ?? []) {
          sessionMap.set(ps.picklist_id, { id: ps.id, status: ps.status })
        }

        // Build BatchPicklistItem[] from Picqer batch picklists
        const picklists: BatchPicklistItem[] = (picqerBatch?.picklists ?? []).map(
          (pl: {
            idpicklist: number
            picklistid: string
            alias: string | null
            delivery_name: string
            reference: string | null
            total_products: number
            status: string
            has_notes: boolean
            has_customer_remarks: boolean
            customer_remarks: string | null
          }) => {
            const ps = sessionMap.get(pl.idpicklist)
            return {
              idpicklist: pl.idpicklist,
              picklistid: pl.picklistid,
              alias: pl.alias ?? null,
              deliveryname: pl.delivery_name,
              reference: pl.reference,
              totalproducts: pl.total_products,
              status: pl.status,
              hasNotes: pl.has_notes,
              hasCustomerRemarks: pl.has_customer_remarks,
              customerRemarks: pl.customer_remarks,
              sessionId: ps?.id,
              sessionStatus: ps?.status,
            }
          }
        )

        // Build batch context products
        const products: BatchContextProduct[] = (picqerBatch?.products ?? [])
          .filter((p: { picklists?: { idpicklist: number; amount: number }[] }) => p.picklists?.length)
          .map((p: { productcode: string; picklists?: { idpicklist: number; amount: number }[] }) => ({
            productcode: p.productcode,
            picklistAllocations: (p.picklists ?? []).map((pl: { idpicklist: number; amount: number }) => ({
              idpicklist: pl.idpicklist,
              amount: pl.amount ?? 0,
            })),
          }))

        if (!cancelled) {
          setBatchContext({
            batchSessionId: batchSessionId!,
            batchDisplayId: batchSessionData?.batch_display_id || String(batchSessionData?.batch_id),
            picklists,
            products,
          })
          setBulkDataLoaded(true)
        }
      } catch (err) {
        console.error('[BatchWorkspace] Bulk load failed:', err)
        // Non-fatal — BatchOverview will fetch its own data via useBatchSession
        if (!cancelled) setBulkDataLoaded(true)
      }
    }

    loadBulkData()
    return () => { cancelled = true }
  }, [batchSessionId, bulkDataLoaded])

  // URL sync: update URL when view changes (without triggering navigation)
  useEffect(() => {
    if (currentView === 'picklist' && activeSessionId) {
      const url = new URL(window.location.href)
      url.searchParams.set('view', 'picklist')
      url.searchParams.set('session', activeSessionId)
      window.history.pushState(null, '', url.toString())
    } else if (currentView === 'overview') {
      const url = new URL(window.location.href)
      url.searchParams.delete('view')
      url.searchParams.delete('session')
      window.history.pushState(null, '', url.toString())
    }
  }, [currentView, activeSessionId])

  // Browser back button support
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search)
      if (params.get('view') === 'picklist' && params.get('session')) {
        setCurrentView('picklist')
        setActiveSessionId(params.get('session'))
      } else {
        setCurrentView('overview')
        setActiveSessionId(null)
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Handle picklist navigation from VerpakkingsClient (state-driven, no route change)
  const handleNavigatePicklist = useCallback(async (picklist: BatchPicklistItem) => {
    if (picklist.sessionId) {
      // Session exists — instant state switch (prefetchCache already populated)
      setActiveSessionId(picklist.sessionId)
      return
    }

    // No session yet — create on the fly
    setIsNavCreatingSession(true)
    try {
      const res = await fetch('/api/verpakking/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picklistId: picklist.idpicklist,
          assignedTo: worker.iduser,
          assignedToName: worker.fullName,
          batchSessionId: batchSessionId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t.batch.sessionCreateFailed)

      // Update batchContext with new session mapping
      setBatchContext(prev => {
        if (!prev) return prev
        return {
          ...prev,
          picklists: prev.picklists.map(pl =>
            pl.idpicklist === picklist.idpicklist
              ? { ...pl, sessionId: data.id, sessionStatus: 'open' }
              : pl
          ),
        }
      })

      setActiveSessionId(data.id)
    } catch (err) {
      console.error('[BatchWorkspace] Failed to create session for navigation:', err)
    } finally {
      setIsNavCreatingSession(false)
    }
  }, [worker, batchSessionId])

  // Handle picklist started from BatchOverview
  const handlePicklistStarted = useCallback((sessionId: string) => {
    // Navigate immediately — don't wait for session lookup
    setActiveSessionId(sessionId)
    setCurrentView('picklist')

    // Fetch session to get picklistId and update batchContext mapping
    fetch(`/api/verpakking/sessions/${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        const raw = data.session ?? data
        const picklistId = raw.picklist_id
        if (picklistId) {
          setBatchContext(prev => {
            if (!prev) return prev
            return {
              ...prev,
              picklists: prev.picklists.map(pl =>
                pl.idpicklist === picklistId
                  ? { ...pl, sessionId, sessionStatus: 'open' }
                  : pl
              ),
            }
          })
        }
      })
      .catch(() => { /* non-critical */ })
  }, [])

  // Handle picklist closed — update batchContext
  const handlePicklistClosed = useCallback((picklistId: number) => {
    setBatchContext(prev => {
      if (!prev) return prev
      return {
        ...prev,
        picklists: prev.picklists.map(pl =>
          pl.idpicklist === picklistId ? { ...pl, status: 'closed' } : pl
        ),
      }
    })
  }, [])

  // Handle batch claimed from BatchOverview
  const handleBatchClaimed = useCallback((newBatchSessionId: string) => {
    onBatchClaimed?.(newBatchSessionId)
  }, [onBatchClaimed])

  // Session creation overlay
  if (isNavCreatingSession) {
    return (
      <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-40">
        <div className="flex items-center gap-3 bg-card px-6 py-4 rounded-lg shadow-lg border border-border">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span className="text-sm font-medium">{t.batch.creatingSession}</span>
        </div>
      </div>
    )
  }

  return (
    <>
      {currentView === 'overview' && (
        <BatchOverview
          batchSessionId={devMode ? null : batchSessionId}
          previewBatchId={(!devMode && batchSessionId) ? null : previewBatchId}
          worker={worker}
          onPicklistStarted={handlePicklistStarted}
          onBatchClaimed={handleBatchClaimed}
          onBack={onBack}
          devMode={devMode}
          onPicklistPreview={onPicklistPreview}
        />
      )}

      {currentView === 'picklist' && activeSessionId && (
        <VerpakkingsClient
          key={activeSessionId}
          sessionId={activeSessionId}
          onBack={() => {
            setCurrentView('overview')
            setActiveSessionId(null)
          }}
          workerName={worker.fullName}
          batchContext={batchContext ?? undefined}
          onPicklistClosed={handlePicklistClosed}
          // Only enable state-driven navigation when batchContext is available
          // Otherwise VerpakkingsClient falls back to its existing route-based flow
          onNavigatePicklist={batchContext ? handleNavigatePicklist : undefined}
        />
      )}
    </>
  )
}
