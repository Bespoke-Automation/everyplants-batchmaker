'use client'

import { useState, useEffect, use, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Code2 } from 'lucide-react'
import { useWorker } from '@/hooks/useWorker'
import BatchOverview from '@/components/verpakking/BatchOverview'
import WorkerSelector from '@/components/verpakking/WorkerSelector'
import type { Worker } from '@/types/verpakking'
import { DEV_MODE_USER_IDS } from '@/lib/constants'
import { useTranslation } from '@/i18n/LanguageContext'

export default function BatchPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId: batchIdStr } = use(params)
  const batchId = parseInt(batchIdStr, 10)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { workers, selectedWorker, isLoading: isLoadingWorker, error: workerError, selectWorker } = useWorker()
  const { t } = useTranslation()

  const [batchSessionId, setBatchSessionId] = useState<string | null>(null)
  const [isLoadingSession, setIsLoadingSession] = useState(true)
  const [devMode, setDevMode] = useState(searchParams.get('dev') === '1')
  const [isCreatingDevSession, setIsCreatingDevSession] = useState(false)

  const canUseDevMode = selectedWorker && DEV_MODE_USER_IDS.includes(selectedWorker.iduser)

  // Check if the current worker already has a session for this batch
  useEffect(() => {
    if (devMode || isNaN(batchId)) {
      setIsLoadingSession(false)
      return
    }

    if (!selectedWorker) {
      setIsLoadingSession(false)
      return
    }

    const checkExistingSession = async () => {
      try {
        // Step 1: Check if worker already has a batch session
        const res = await fetch('/api/verpakking/batch-sessions?active=true')
        if (res.ok) {
          const data = await res.json()
          const sessions = data.sessions ?? []
          const existing = sessions.find(
            (s: { batch_id: number; assigned_to: number; status: string }) =>
              s.batch_id === batchId && s.assigned_to === selectedWorker.iduser
          )
          if (existing) {
            setBatchSessionId(existing.id)
            return
          }
        }

        // Step 2: No session — check if Picqer batch is assigned to this worker → auto-claim
        try {
          const picqerRes = await fetch(`/api/picqer/picklist-batches/${batchId}`)
          if (picqerRes.ok) {
            const picqerData = await picqerRes.json()
            const assignedUserId = picqerData.assigned_to?.iduser
            if (assignedUserId === selectedWorker.iduser) {
              // Picqer batch is assigned to this worker — auto-create batch session
              const claimRes = await fetch('/api/verpakking/batch-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  batchId,
                  batchDisplayId: picqerData.picklist_batchid || String(batchId),
                  totalPicklists: picqerData.total_picklists ?? 0,
                  assignedTo: selectedWorker.iduser,
                  assignedToName: selectedWorker.fullName,
                }),
              })
              if (claimRes.ok) {
                const claimData = await claimRes.json()
                setBatchSessionId(claimData.id)
                return
              }
            }
          }
        } catch {
          // Non-critical — fall through to preview mode
        }
      } catch {
        // Ignore — preview mode is fine
      } finally {
        setIsLoadingSession(false)
      }
    }

    checkExistingSession()
  }, [selectedWorker, batchId, devMode])

  // Dev mode: create a dev session for a picklist (no Picqer assignment)
  const handleDevPicklistOpen = useCallback(async (picklistId: number) => {
    if (!selectedWorker) return
    setIsCreatingDevSession(true)

    try {
      const res = await fetch('/api/verpakking/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picklistId,
          assignedTo: selectedWorker.iduser,
          assignedToName: selectedWorker.fullName,
          devMode: true,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t.batch.sessionCreateFailed)

      router.push(`/verpakkingsmodule/picklist/${data.id}?batchId=${batchId}`)
    } catch (err) {
      console.error('Dev session creation failed:', err)
      // Fallback to engine preview
      router.push(`/verpakkingsmodule/engine-preview/${picklistId}`)
    } finally {
      setIsCreatingDevSession(false)
    }
  }, [selectedWorker, router])

  if (isNaN(batchId)) {
    router.replace('/verpakkingsmodule')
    return null
  }

  const devModeToggle = canUseDevMode ? (
    <button
      onClick={() => setDevMode(prev => !prev)}
      className={`fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium shadow-lg transition-colors ${
        devMode
          ? 'bg-violet-600 text-white hover:bg-violet-700'
          : 'bg-white text-muted-foreground border border-border hover:bg-muted'
      }`}
    >
      <Code2 className="w-3.5 h-3.5" />
      {devMode ? t.batch.devModeOn : t.batch.devMode}
    </button>
  ) : null

  // No worker selected → show WorkerSelector
  if (!selectedWorker && !isLoadingWorker) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <WorkerSelector
          workers={workers}
          isLoading={isLoadingWorker}
          error={workerError}
          onSelectWorker={selectWorker}
        />
      </main>
    )
  }

  if (!devMode && (isLoadingWorker || isLoadingSession)) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        {devModeToggle}
      </main>
    )
  }

  const worker: Worker = selectedWorker ?? { iduser: 0, firstname: 'Dev', lastname: 'Mode', fullName: t.batch.devMode }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
        <BatchOverview
          batchSessionId={devMode ? null : batchSessionId}
          previewBatchId={(!devMode && batchSessionId) ? null : batchId}
          worker={worker}
          onPicklistStarted={(sessionId) => {
            router.push(`/verpakkingsmodule/picklist/${sessionId}`)
          }}
          onBatchClaimed={(newBatchSessionId) => {
            setBatchSessionId(newBatchSessionId)
          }}
          onBack={() => {
            router.push('/verpakkingsmodule')
          }}
          devMode={devMode}
          onPicklistPreview={(picklistId) => {
            handleDevPicklistOpen(picklistId)
          }}
        />
      </div>

      {/* Dev session loading overlay */}
      {isCreatingDevSession && (
        <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-40">
          <div className="flex items-center gap-3 bg-card px-6 py-4 rounded-lg shadow-lg border border-border">
            <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
            <span className="text-sm font-medium">{t.batch.devSessionCreating}</span>
          </div>
        </div>
      )}

      {devModeToggle}
    </main>
  )
}
