'use client'

import { User, Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import type { Worker } from '@/types/verpakking'

interface WorkerSelectorProps {
  workers: Worker[]
  isLoading: boolean
  error: Error | null
  onSelectWorker: (worker: Worker) => void
}

function getInitials(worker: Worker): string {
  const first = worker.firstname?.[0] ?? ''
  const last = worker.lastname?.[0] ?? ''
  return (first + last).toUpperCase() || '?'
}

// Consistent color based on worker id
const COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-pink-500',
]

function getColor(iduser: number): string {
  return COLORS[iduser % COLORS.length]
}

export default function WorkerSelector({
  workers,
  isLoading,
  error,
  onSelectWorker,
}: WorkerSelectorProps) {
  // Error state
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Fout bij laden</h2>
            <p className="text-muted-foreground">{error.message}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors min-h-[48px]"
          >
            <RefreshCw className="w-5 h-5" />
            Opnieuw proberen
          </button>
        </div>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Medewerkers laden...</p>
      </div>
    )
  }

  // Empty state
  if (workers.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <User className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Geen medewerkers gevonden</h2>
            <p className="text-muted-foreground">
              Er zijn geen actieve medewerkers gevonden in Picqer.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors min-h-[48px]"
          >
            <RefreshCw className="w-5 h-5" />
            Vernieuwen
          </button>
        </div>
      </div>
    )
  }

  // Worker grid
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold">Wie ben jij?</h2>
          <p className="text-muted-foreground mt-2 text-base">
            Selecteer je naam om te beginnen
          </p>
        </div>

        {/* Worker grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {workers.map((worker) => (
            <button
              key={worker.iduser}
              onClick={() => onSelectWorker(worker)}
              className="flex flex-col items-center gap-3 p-5 sm:p-6 bg-card border border-border rounded-xl hover:border-primary hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all min-h-[100px] cursor-pointer"
            >
              <div
                className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full ${getColor(worker.iduser)} text-white flex items-center justify-center text-xl sm:text-2xl font-bold shrink-0`}
              >
                {getInitials(worker)}
              </div>
              <div className="text-center min-w-0 w-full">
                <p className="font-semibold text-base sm:text-lg truncate">
                  {worker.firstname}
                </p>
                <p className="text-sm text-muted-foreground truncate">
                  {worker.lastname}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
