'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useWorker } from '@/hooks/useWorker'
import VerpakkingsClient from '@/components/verpakking/VerpakkingsClient'
import WorkerSelector from '@/components/verpakking/WorkerSelector'

export default function PicklistPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params)
  const router = useRouter()
  const { workers, selectedWorker, isLoading: isLoadingWorker, error: workerError, selectWorker } = useWorker()

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
          // Navigate back to the batch page or queue
          if (window.history.length > 1) {
            router.back()
          } else {
            router.push('/verpakkingsmodule')
          }
        }}
        workerName={selectedWorker!.fullName}
      />
    </main>
  )
}
