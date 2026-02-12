'use client'

import { useState, useEffect } from 'react'
import { useWorker } from '@/hooks/useWorker'
import WorkerSelector from '@/components/verpakking/WorkerSelector'
import BatchQueue from '@/components/verpakking/BatchQueue'
import BatchOverview from '@/components/verpakking/BatchOverview'
import VerpakkingsClient from '@/components/verpakking/VerpakkingsClient'

export default function VerpakkingsmodulePage() {
  const { workers, selectedWorker, isLoading, error, selectWorker, clearWorker } = useWorker()

  const [activeBatchSessionId, setActiveBatchSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('verpakking_active_batch_session')
    }
    return null
  })

  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('verpakking_active_session')
    }
    return null
  })

  useEffect(() => {
    if (activeBatchSessionId) {
      sessionStorage.setItem('verpakking_active_batch_session', activeBatchSessionId)
    } else {
      sessionStorage.removeItem('verpakking_active_batch_session')
    }
  }, [activeBatchSessionId])

  useEffect(() => {
    if (activeSessionId) {
      sessionStorage.setItem('verpakking_active_session', activeSessionId)
    } else {
      sessionStorage.removeItem('verpakking_active_session')
    }
  }, [activeSessionId])

  // Step 1: No worker selected → show WorkerSelector
  if (!selectedWorker) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <WorkerSelector
          workers={workers}
          isLoading={isLoading}
          error={error}
          onSelectWorker={selectWorker}
        />
      </main>
    )
  }

  // Step 2: No active batch → show Batch Queue
  if (!activeBatchSessionId) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
          <BatchQueue
            worker={selectedWorker}
            onClearWorker={clearWorker}
            onBatchClaimed={(batchSessionId) => setActiveBatchSessionId(batchSessionId)}
          />
        </div>
      </main>
    )
  }

  // Step 3: Batch active, no picklist session → show Batch Overview
  if (!activeSessionId) {
    return (
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="w-full flex-1 flex flex-col overflow-y-auto px-6">
          <BatchOverview
            batchSessionId={activeBatchSessionId}
            worker={selectedWorker}
            onPicklistStarted={(sessionId) => setActiveSessionId(sessionId)}
            onBack={() => setActiveBatchSessionId(null)}
          />
        </div>
      </main>
    )
  }

  // Step 4: Picklist session active → show packing screen
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <VerpakkingsClient
        sessionId={activeSessionId}
        onBack={() => setActiveSessionId(null)}
        workerName={selectedWorker.fullName}
      />
    </main>
  )
}
