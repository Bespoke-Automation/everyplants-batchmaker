'use client'

import { useState, useEffect } from 'react'
import { User, Loader2, AlertCircle, RefreshCw, Monitor, Printer } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'
import type { Worker } from '@/types/verpakking'
import type { PackingStation, PrinterStatus } from '@/hooks/usePackingStation'

const STATUS_CONFIG: Record<PrinterStatus, { dot: string; bg: string; text: string; labelNl: string; labelEn: string }> = {
  online:       { dot: 'bg-emerald-500', bg: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-600', labelNl: 'Online', labelEn: 'Online' },
  offline:      { dot: 'bg-red-500',     bg: 'bg-red-100 text-red-700',         text: 'text-red-500',     labelNl: 'Offline', labelEn: 'Offline' },
  disconnected: { dot: 'bg-amber-500',   bg: 'bg-amber-100 text-amber-700',     text: 'text-amber-600',   labelNl: 'Niet verbonden', labelEn: 'Not connected' },
  unknown:      { dot: 'bg-gray-400',    bg: 'bg-gray-100 text-gray-500',        text: 'text-gray-400',    labelNl: 'Onbekend', labelEn: 'Unknown' },
}

interface WorkerSelectorProps {
  workers: Worker[]
  isLoading: boolean
  error: Error | null
  onSelectWorker: (worker: Worker) => void
  // Packing station props (optional — if not provided, skip station step)
  stations?: PackingStation[]
  selectedStation?: PackingStation | null
  onSelectStation?: (station: PackingStation) => void
  onSkipStation?: () => void
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
  stations,
  selectedStation,
  onSelectStation,
  onSkipStation,
}: WorkerSelectorProps) {
  const { t, language } = useTranslation()
  // Step state: 'worker' or 'station'
  const [step, setStep] = useState<'worker' | 'station'>('worker')
  const [pendingWorker, setPendingWorker] = useState<Worker | null>(null)

  // If station is already selected (from localStorage), skip the station step
  const hasStations = stations && stations.length > 0 && onSelectStation

  const handleWorkerClick = (worker: Worker) => {
    if (hasStations && !selectedStation) {
      // Show station selection step
      setPendingWorker(worker)
      setStep('station')
    } else {
      // No stations configured or station already selected — proceed directly
      onSelectWorker(worker)
    }
  }

  const handleStationClick = (station: PackingStation) => {
    onSelectStation!(station)
    if (pendingWorker) {
      onSelectWorker(pendingWorker)
    }
  }

  const handleSkipStation = () => {
    onSkipStation?.()
    if (pendingWorker) {
      onSelectWorker(pendingWorker)
    }
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">{t.worker.loadError}</h2>
            <p className="text-muted-foreground">{error.message}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors min-h-[48px]"
          >
            <RefreshCw className="w-5 h-5" />
            {t.worker.retryLoad}
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
        <p className="text-lg text-muted-foreground">{t.worker.loadingWorkers}</p>
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
            <h2 className="text-xl font-bold mb-2">{t.worker.noWorkers}</h2>
            <p className="text-muted-foreground">
              {t.worker.noWorkersDesc}
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors min-h-[48px]"
          >
            <RefreshCw className="w-5 h-5" />
            {t.worker.refresh}
          </button>
        </div>
      </div>
    )
  }

  // Step 2: Station selection
  if (step === 'station' && hasStations && pendingWorker) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-3xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Monitor className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold">{t.worker.chooseStation}</h2>
            <p className="text-muted-foreground mt-2 text-base">
              {t.worker.stationHint}
            </p>
          </div>

          {/* Station grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
            {stations!.map((station) => {
              const status = station.printer_status ?? 'unknown'
              const cfg = STATUS_CONFIG[status]
              return (
                <button
                  key={station.id}
                  onClick={() => handleStationClick(station)}
                  className="flex flex-col items-center gap-3 p-5 sm:p-6 bg-card border border-border rounded-xl hover:border-primary hover:shadow-md hover:scale-[1.02] active:scale-[0.98] transition-all min-h-[100px] cursor-pointer"
                >
                  <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full ${cfg.bg} flex items-center justify-center shrink-0`}>
                    <Printer className="w-7 h-7 sm:w-8 sm:h-8" />
                  </div>
                  <div className="text-center min-w-0 w-full">
                    <p className="font-semibold text-base sm:text-lg truncate">
                      {station.name}
                    </p>
                    {station.printnode_printer_name && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {station.printnode_printer_name}
                      </p>
                    )}
                    <div className={`flex items-center justify-center gap-1.5 mt-1.5 text-xs font-medium ${cfg.text}`}>
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      {language === 'nl' ? cfg.labelNl : cfg.labelEn}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {/* Skip / back buttons */}
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => {
                setStep('worker')
                setPendingWorker(null)
              }}
              className="px-4 py-2.5 min-h-[48px] text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
            >
              {t.common.back}
            </button>
            <button
              onClick={handleSkipStation}
              className="px-4 py-2.5 min-h-[48px] text-sm text-muted-foreground hover:bg-muted rounded-lg transition-colors"
            >
              {t.worker.skipStation}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Step 1: Worker grid
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold">{t.worker.whoAreYou}</h2>
          <p className="text-muted-foreground mt-2 text-base">
            {t.worker.selectToStart}
          </p>
        </div>

        {/* Worker grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {workers.map((worker) => (
            <button
              key={worker.iduser}
              onClick={() => handleWorkerClick(worker)}
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
