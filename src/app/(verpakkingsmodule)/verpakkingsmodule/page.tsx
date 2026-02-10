'use client'

import { useState, useEffect } from 'react'
import { useWorker } from '@/hooks/useWorker'
import WorkerSelector from '@/components/verpakking/WorkerSelector'
import PicklistQueue from '@/components/verpakking/PicklistQueue'
import VerpakkingsClient from '@/components/verpakking/VerpakkingsClient'

export default function VerpakkingsmodulePage() {
  const { workers, selectedWorker, isLoading, error, selectWorker, clearWorker } = useWorker()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('verpakking_active_session')
    }
    return null
  })

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
      <main className="flex-1 flex flex-col">
        <WorkerSelector
          workers={workers}
          isLoading={isLoading}
          error={error}
          onSelectWorker={selectWorker}
        />
      </main>
    )
  }

  // Step 2: Worker selected but no active session → show Queue
  if (!activeSessionId) {
    return (
      <main className="flex-1 flex flex-col">
        <PicklistQueue
          worker={selectedWorker}
          onClearWorker={clearWorker}
          onSessionStarted={(sessionId) => setActiveSessionId(sessionId)}
        />
      </main>
    )
  }

  // Step 3: Active session → show packing screen
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
