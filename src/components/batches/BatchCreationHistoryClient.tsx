'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useBatchCreationHistory } from '@/hooks/useBatchCreationHistory'
import BatchCreationHistoryTable from '@/components/batches/BatchCreationHistoryTable'

export default function BatchCreationHistoryClient() {
  const {
    creations,
    totalCount,
    page,
    totalPages,
    isLoading,
    error,
    goToPage,
    refetch,
  } = useBatchCreationHistory()

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-destructive font-semibold">Fout bij laden van batch geschiedenis</div>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
        >
          Opnieuw proberen
        </button>
      </div>
    )
  }

  return (
    <main className="flex-1 p-6 space-y-6 overflow-auto">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Link
          href="/batchmaker/batches"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Terug naar Batches
        </Link>
      </div>

      {/* Batch creation history table */}
      <BatchCreationHistoryTable
        creations={creations}
        isLoading={isLoading}
        onRefresh={refetch}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPageChange={goToPage}
      />
    </main>
  )
}
