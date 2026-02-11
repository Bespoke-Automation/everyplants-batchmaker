'use client'

import { Check, Loader2, AlertCircle, AlertTriangle, Clock, Download, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import type { BoxShipmentStatus } from '@/types/verpakking'

// Session box type (matches usePackingSession internal type)
interface SessionBox {
  id: string
  packagingName: string
  picqerPackagingId: number | null
  packagingBarcode: string | null
  boxIndex: number
  status: string
  products: Array<{
    id: string
    productName: string
    amount: number
  }>
}

interface ShipmentProgressProps {
  boxes: SessionBox[]
  shipProgress: Map<string, BoxShipmentStatus>
  isOpen: boolean
  onClose: () => void
  onShipAll: (shippingProviderId: number) => void
  onRetryBox: (boxId: string) => void
  shippingProviderId: number | null
}

function getStatusIcon(status: BoxShipmentStatus['status'] | undefined) {
  switch (status) {
    case 'shipped':
    case 'labeled':
      return <Check className="w-5 h-5 text-green-600" />
    case 'shipping':
    case 'fetching_label':
      return <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
    case 'error':
      return <AlertCircle className="w-5 h-5 text-red-600" />
    default:
      return <Clock className="w-5 h-5 text-gray-400" />
  }
}

function getStatusText(status: BoxShipmentStatus['status'] | undefined) {
  switch (status) {
    case 'shipped':
      return 'Verzonden'
    case 'labeled':
      return 'Label aangemaakt'
    case 'shipping':
      return 'Zending aanmaken...'
    case 'fetching_label':
      return 'Label ophalen...'
    case 'error':
      return 'Fout'
    default:
      return 'Wachten...'
  }
}

export default function ShipmentProgress({
  boxes,
  shipProgress,
  isOpen,
  onClose,
  onShipAll,
  onRetryBox,
  shippingProviderId,
}: ShipmentProgressProps) {
  const shippedCount = boxes.filter((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'shipped' || progress?.status === 'labeled'
  }).length

  const hasErrors = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'error'
  })

  const totalBoxes = boxes.length
  const progressPercentage = totalBoxes > 0 ? Math.round((shippedCount / totalBoxes) * 100) : 0
  const allDone = shippedCount === totalBoxes && totalBoxes > 0

  const isShipping = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.status === 'shipping' || progress?.status === 'fetching_label'
  })

  const sessionCompleted = boxes.some((box) => {
    const progress = shipProgress.get(box.id)
    return progress?.sessionCompleted === true
  })

  // Collect all label URLs for bulk download
  const labelUrls = boxes
    .map((box) => shipProgress.get(box.id))
    .filter((p): p is BoxShipmentStatus => !!p && !!p.labelUrl)
    .map((p) => p.labelUrl!)

  const handleDownloadAllLabels = () => {
    for (const url of labelUrls) {
      window.open(url, '_blank')
    }
  }

  const handleStartShipping = () => {
    if (shippingProviderId) {
      onShipAll(shippingProviderId)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title="Zendingen maken"
      className="max-w-lg"
    >
      <div className="p-4">
        {/* Box list */}
        <div className="space-y-3 mb-6">
          {boxes.map((box) => {
            const progress = shipProgress.get(box.id)
            const status = progress?.status

            return (
              <div
                key={box.id}
                className={`border rounded-lg p-3 ${
                  status === 'shipped' || status === 'labeled'
                    ? 'border-green-200 bg-green-50/50'
                    : status === 'error'
                    ? 'border-red-200 bg-red-50/50'
                    : status === 'shipping' || status === 'fetching_label'
                    ? 'border-blue-200 bg-blue-50/50'
                    : 'border-border'
                }`}
              >
                <div className="flex items-center gap-3">
                  {getStatusIcon(status)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      Doos {box.boxIndex + 1}: {box.packagingName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {getStatusText(status)}
                      {progress?.trackingCode && (
                        <span className="ml-1 font-mono">{progress.trackingCode}</span>
                      )}
                    </p>
                    {progress?.error && (
                      <p className="text-xs text-red-600 mt-1">{progress.error}</p>
                    )}
                    {progress?.warning && (
                      <p className="text-xs text-amber-700 mt-1 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>{progress.warning}</span>
                      </p>
                    )}
                  </div>
                  {status === 'error' && (
                    <button
                      onClick={() => onRetryBox(box.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors flex-shrink-0"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Opnieuw proberen
                    </button>
                  )}
                  {progress?.labelUrl && (
                    <a
                      href={progress.labelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Label
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Session completed banner */}
        {sessionCompleted && (
          <div className="mb-4 flex items-start gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-green-600" />
            <span>Sessie voltooid - alle dozen zijn verzonden en de picklist is afgesloten in Picqer</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">
              Voortgang: {shippedCount}/{totalBoxes} dozen verzonden
            </span>
            <span className="font-medium">{progressPercentage}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                hasErrors ? 'bg-amber-500' : allDone ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          {/* Start shipping (only show if no progress yet and boxes exist) */}
          {boxes.length === 0 && shipProgress.size === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Geen dozen om te verzenden
            </p>
          ) : shipProgress.size === 0 && shippingProviderId ? (
            <button
              onClick={handleStartShipping}
              className="px-4 py-2 min-h-[48px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Start verzenden
            </button>
          ) : null}

          {/* Download all labels */}
          {labelUrls.length > 0 && (
            <button
              onClick={handleDownloadAllLabels}
              className="flex items-center gap-2 px-4 py-2 min-h-[48px] text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Alle labels downloaden
            </button>
          )}

          {/* Spacer when only close button shows */}
          {shipProgress.size > 0 && labelUrls.length === 0 && <div />}

          <button
            onClick={onClose}
            disabled={isShipping}
            className={`px-4 py-2 min-h-[48px] text-sm rounded-lg transition-colors ${
              isShipping
                ? 'text-muted-foreground bg-muted cursor-not-allowed'
                : 'hover:bg-muted'
            }`}
          >
            Sluiten
          </button>
        </div>
      </div>
    </Dialog>
  )
}
