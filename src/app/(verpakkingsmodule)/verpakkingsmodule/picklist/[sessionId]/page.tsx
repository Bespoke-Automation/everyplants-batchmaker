'use client'

import { use, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useWorker } from '@/hooks/useWorker'
import { usePackingStation } from '@/hooks/usePackingStation'
import VerpakkingsClient from '@/components/verpakking/VerpakkingsClient'
import WorkerSelector from '@/components/verpakking/WorkerSelector'
import type { BatchPicklistItem } from '@/types/verpakking'

interface BatchContext {
  batchSessionId: string
  batchDisplayId: string
  picqerBatchId: number | null
  picklists: BatchPicklistItem[]
}

type PicqerPicklistRaw = {
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
}

function mapPicqerPicklists(
  rawPicklists: PicqerPicklistRaw[],
  sessionMap: Map<number, { id: string; status: string }>
): BatchPicklistItem[] {
  return rawPicklists.map((pl) => {
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
  })
}

export default function PicklistPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const batchIdParam = searchParams.get('batchId')
  const { workers, selectedWorker, isLoading: isLoadingWorker, error: workerError, selectWorker } = useWorker()
  const { stations, selectedStation, selectStation, clearStation } = usePackingStation()
  // Restore batchContext from sessionStorage on mount (persists across picklist navigation)
  const [batchContext, setBatchContext] = useState<BatchContext | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const cached = sessionStorage.getItem('verpakking_batch_context')
      return cached ? JSON.parse(cached) : null
    } catch { return null }
  })

  // Persist batchContext to sessionStorage whenever it changes
  useEffect(() => {
    if (batchContext) {
      sessionStorage.setItem('verpakking_batch_context', JSON.stringify(batchContext))
    }
  }, [batchContext])

  // Fetch batch context with rich picklist data (alias, deliveryname, etc.)
  useEffect(() => {
    // Skip re-fetch if we already have batch context AND the current session is found in it
    if (batchContext && batchContext.picklists.some((pl) => pl.sessionId === sessionId)) {
      return
    }

    let cancelled = false

    async function fetchBatchContext() {
      try {
        // Step 1: Get current session to find batch_session_id
        const sessionRes = await fetch(`/api/verpakking/sessions/${sessionId}`)
        if (!sessionRes.ok) return
        const sessionData = await sessionRes.json()
        const raw = sessionData.session ?? sessionData
        const batchSessionId: string | null = raw.batch_session_id

        if (batchSessionId) {
          // Normal flow: fetch via Supabase batch session
          await fetchViaBatchSession(batchSessionId, cancelled)
        } else if (batchIdParam) {
          // Fallback: fetch directly from Picqer using batchId query param
          await fetchDirectFromPicqer(parseInt(batchIdParam, 10), cancelled)
        } else {
          // No batch_session_id and no batchId param — check Picqer if picklist belongs to a batch
          const picklistId = raw.picklist_id
          if (picklistId) {
            const plRes = await fetch(`/api/picqer/picklists/${picklistId}`)
            if (plRes.ok) {
              const plData = await plRes.json()
              const picqerBatchId = plData.picklist?.idpicklist_batch ?? plData.idpicklist_batch
              if (picqerBatchId) {
                await fetchDirectFromPicqer(picqerBatchId, cancelled)
              }
            }
          }
        }
      } catch {
        // Silent fail — batch nav bar just won't show
      }
    }

    async function fetchViaBatchSession(batchSessionId: string, isCancelled: boolean) {
      const batchRes = await fetch(`/api/verpakking/batch-sessions/${batchSessionId}`)
      if (!batchRes.ok) return
      const batchData = await batchRes.json()

      if (isCancelled) return

      // Build packing session map (picklist_id → session info)
      const packingSessionMap = new Map<number, { id: string; status: string }>()
      for (const ps of batchData.packing_sessions ?? []) {
        packingSessionMap.set(ps.picklist_id, { id: ps.id, status: ps.status })
      }

      const batchId = batchData.batch_id
      const picqerRes = await fetch(`/api/picqer/picklist-batches/${batchId}`)

      if (isCancelled) return

      if (picqerRes.ok) {
        const picqerData = await picqerRes.json()
        const picklists = mapPicqerPicklists(picqerData.picklists ?? [], packingSessionMap)

        setBatchContext({
          batchSessionId,
          batchDisplayId: batchData.batch_display_id || String(batchId),
          picqerBatchId: batchId,
          picklists,
        })
      } else {
        // Fallback: use minimal data from Supabase only
        const picklists: BatchPicklistItem[] = (batchData.packing_sessions ?? []).map(
          (ps: { id: string; picklist_id: number; picklistid: string; status: string }) => ({
            idpicklist: ps.picklist_id,
            picklistid: ps.picklistid || String(ps.picklist_id),
            alias: null,
            deliveryname: '',
            reference: null,
            totalproducts: 0,
            status: ps.status,
            hasNotes: false,
            hasCustomerRemarks: false,
            customerRemarks: null,
            sessionId: ps.id,
            sessionStatus: ps.status,
          })
        )

        setBatchContext({
          batchSessionId,
          batchDisplayId: batchData.batch_display_id || String(batchId),
          picqerBatchId: batchId,
          picklists,
        })
      }
    }

    async function fetchDirectFromPicqer(batchId: number, isCancelled: boolean) {
      const picqerRes = await fetch(`/api/picqer/picklist-batches/${batchId}`)
      if (!picqerRes.ok || isCancelled) return

      const picqerData = await picqerRes.json()

      // Fetch all packing sessions to map picklist_id → session info
      const sessionMap = new Map<number, { id: string; status: string }>()
      try {
        const sessionsRes = await fetch('/api/verpakking/sessions')
        if (sessionsRes.ok) {
          const sessionsData = await sessionsRes.json()
          const allSessions = sessionsData.sessions ?? sessionsData ?? []
          // Collect picklist IDs in this batch
          const batchPicklistIds = new Set((picqerData.picklists ?? []).map((pl: { idpicklist: number }) => pl.idpicklist))
          for (const s of allSessions) {
            if (batchPicklistIds.has(s.picklist_id) && s.status !== 'completed') {
              sessionMap.set(s.picklist_id, { id: s.id, status: s.status })
            }
          }
          // Also include completed sessions as fallback (if no active one)
          for (const s of allSessions) {
            if (batchPicklistIds.has(s.picklist_id) && !sessionMap.has(s.picklist_id)) {
              sessionMap.set(s.picklist_id, { id: s.id, status: s.status })
            }
          }
        }
      } catch {
        // Fallback: at least map the current session
      }

      const picklists = mapPicqerPicklists(picqerData.picklists ?? [], sessionMap)

      // Ensure current session is mapped (fallback if sessions API didn't return it)
      const currentPicklistId = (await fetch(`/api/verpakking/sessions/${sessionId}`).then(r => r.json()).then(d => (d.session ?? d).picklist_id).catch(() => null))
      for (const pl of picklists) {
        if (pl.idpicklist === currentPicklistId && !pl.sessionId) {
          pl.sessionId = sessionId
        }
      }

      if (isCancelled) return

      setBatchContext({
        batchSessionId: '',
        batchDisplayId: picqerData.picklist_batchid || String(batchId),
        picqerBatchId: batchId,
        picklists,
      })
    }

    fetchBatchContext()
    return () => { cancelled = true }
  }, [sessionId, batchIdParam])

  // No worker selected → show WorkerSelector
  if (!selectedWorker && !isLoadingWorker) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <WorkerSelector
          workers={workers}
          isLoading={isLoadingWorker}
          error={workerError}
          onSelectWorker={selectWorker}
          stations={stations}
          selectedStation={selectedStation}
          onSelectStation={selectStation}
          onSkipStation={clearStation}
        />
      </main>
    )
  }

  if (isLoadingWorker) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <VerpakkingsClient
        sessionId={sessionId}
        onBack={() => {
          if (batchContext?.picqerBatchId) {
            router.push(`/verpakkingsmodule/batch/${batchContext.picqerBatchId}`)
          } else if (window.history.length > 1) {
            router.back()
          } else {
            router.push('/verpakkingsmodule')
          }
        }}
        workerName={selectedWorker!.fullName}
        batchContext={batchContext ?? undefined}
      />
    </main>
  )
}
