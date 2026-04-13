'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Code2 } from 'lucide-react'
import { useWorker } from '@/hooks/useWorker'
import { usePackingStation } from '@/hooks/usePackingStation'
import WorkerSelector from '@/components/verpakking/WorkerSelector'
import BatchQueue from '@/components/verpakking/BatchQueue'
import BatchOverview from '@/components/verpakking/BatchOverview'
import VerpakkingsClient from '@/components/verpakking/VerpakkingsClient'
import EnginePreviewPanel from '@/components/verpakking/EnginePreviewPanel'
import { DEV_MODE_USER_IDS } from '@/lib/constants'
import { useTranslation } from '@/i18n/LanguageContext'
import WorkerScoreWidget from '@/components/verpakking/insights/WorkerScoreWidget'

export default function VerpakkingsmodulePage() {
  const router = useRouter()
  const { workers, selectedWorker, isLoading, error, selectWorker, clearWorker } = useWorker()
  const { stations, selectedStation, selectStation, clearStation } = usePackingStation()
  const { t } = useTranslation()

  // Developer mode: browse batches/picklists without claiming, preview engine advice
  const canUseDevMode = selectedWorker && DEV_MODE_USER_IDS.includes(selectedWorker.iduser)
  const [devMode, setDevMode] = useState(false)
  const [devPreviewBatchId, setDevPreviewBatchId] = useState<number | null>(null)
  const [devPreviewPicklist, setDevPreviewPicklist] = useState<{ id: number; displayId: string } | null>(null)

  // Restore active session from sessionStorage (for backwards compat / mid-session refresh)
  useEffect(() => {
    const activeSessionId = sessionStorage.getItem('verpakking_active_session')
    if (activeSessionId) {
      sessionStorage.removeItem('verpakking_active_session')
      router.replace(`/verpakkingsmodule/picklist/${activeSessionId}`)
      return
    }
    const activeBatchSession = sessionStorage.getItem('verpakking_active_batch_session')
    if (activeBatchSession) {
      // We need the Picqer batch ID, not the session UUID — fetch it
      fetch(`/api/verpakking/batch-sessions/${activeBatchSession}`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          sessionStorage.removeItem('verpakking_active_batch_session')
          if (data?.batch_id) {
            router.replace(`/verpakkingsmodule/batch/${data.batch_id}`)
          }
        })
        .catch(() => {
          sessionStorage.removeItem('verpakking_active_batch_session')
        })
    }
  }, [router])

  // Dev mode toggle button (only for authorized users)
  const devModeToggle = canUseDevMode ? (
    <button
      onClick={() => {
        setDevMode(prev => !prev)
        setDevPreviewPicklist(null)
        setDevPreviewBatchId(null)
      }}
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

  // Dev mode: Engine Preview for a picklist
  if (devMode && devPreviewPicklist) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col overflow-y-auto">
          <EnginePreviewPanel
            picklistId={devPreviewPicklist.id}
            picklistDisplayId={devPreviewPicklist.displayId}
            onBack={() => setDevPreviewPicklist(null)}
          />
        </div>
        {devModeToggle}
      </main>
    )
  }

  // Dev mode: skip WorkerSelector, go straight to BatchQueue
  if (devMode && !devPreviewBatchId) {
    const dummyWorker = selectedWorker || { iduser: 0, firstname: 'Dev', lastname: 'Mode', fullName: t.batch.devMode }
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
          <BatchQueue
            worker={dummyWorker}
            onClearWorker={() => setDevMode(false)}
            onBatchPreview={(batchId) => setDevPreviewBatchId(batchId)}
            onBatchClaimed={() => {}} // No-op in dev mode
          />
        </div>
        {devModeToggle}
      </main>
    )
  }

  // Dev mode: BatchOverview in preview-only, picklist click → engine preview
  if (devMode && devPreviewBatchId) {
    const dummyWorker = selectedWorker || { iduser: 0, firstname: 'Dev', lastname: 'Mode', fullName: t.batch.devMode }
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
          <BatchOverview
            batchSessionId={null}
            previewBatchId={devPreviewBatchId}
            worker={dummyWorker}
            onPicklistStarted={() => {}} // No-op in dev mode
            onBatchClaimed={() => {}} // No-op in dev mode
            onBack={() => setDevPreviewBatchId(null)}
            devMode
            onPicklistPreview={(picklistId, displayId) =>
              setDevPreviewPicklist({ id: picklistId, displayId })
            }
          />
        </div>
        {devModeToggle}
      </main>
    )
  }

  // ── Normal flow (non-dev mode) ──

  // Step 1: No worker selected → show WorkerSelector
  if (!selectedWorker) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <WorkerSelector
          workers={workers}
          isLoading={isLoading}
          error={error}
          onSelectWorker={selectWorker}
          stations={stations}
          selectedStation={selectedStation}
          onSelectStation={selectStation}
          onSkipStation={clearStation}
        />
        {devModeToggle}
      </main>
    )
  }

  // Step 2: Show Batch Queue — clicks navigate to batch URL
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
        {/* Worker score widget — shows follow rate badge next to the queue */}
        {selectedWorker && (
          <div className="flex justify-end pt-3 pb-1">
            <WorkerScoreWidget workerId={selectedWorker.iduser} />
          </div>
        )}
        <BatchQueue
          worker={selectedWorker}
          onClearWorker={clearWorker}
          onBatchPreview={(batchId) => router.push(`/verpakkingsmodule/batch/${batchId}`)}
          onBatchClaimed={(_batchSessionId, batchId) => {
            if (batchId) {
              router.push(`/verpakkingsmodule/batch/${batchId}`)
            }
          }}
        />
      </div>
      {devModeToggle}
    </main>
  )
}
