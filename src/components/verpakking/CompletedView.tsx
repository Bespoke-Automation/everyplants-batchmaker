'use client'

import {
  CheckCircle2,
  ChevronRight,
  Printer,
  PackagePlus,
  FileText,
} from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'
import type { BatchPicklistItem } from '@/types/verpakking'

interface SessionBox {
  id: string
  status: string
  labelUrl: string | null
}

interface CompletedViewProps {
  session: { picklistId: number; boxes: SessionBox[] }
  nextPicklist: BatchPicklistItem | null
  isBatchCompleted: boolean
  batchProgress?: { completed: number; total: number }
  onNextPicklist: () => void
  onBackToBatches: () => void
  onExtraShipment: () => void
  sessionId: string
}

/**
 * Banner + quick actions for completed picklists.
 * Renders ABOVE the existing read-only products/boxes/sidebar layout.
 */
export default function CompletedView({
  session,
  nextPicklist,
  isBatchCompleted,
  batchProgress,
  onNextPicklist,
  onBackToBatches,
  onExtraShipment,
  sessionId,
}: CompletedViewProps) {
  const { t } = useTranslation()

  const shippedBoxes = session.boxes.filter(
    (b) => b.status === 'shipped' || b.status === 'label_fetched'
  )

  const handleDownloadAllLabels = () => {
    const labelUrls = shippedBoxes.filter((b) => b.labelUrl).map((b) => b.labelUrl!)
    if (labelUrls.length === 1) {
      window.open(labelUrls[0], '_blank')
    } else if (labelUrls.length > 1) {
      window.open(`/api/verpakking/sessions/${sessionId}/labels/combined`, '_blank')
    }
  }

  const handleDownloadPakbon = () => {
    window.open(`/api/picqer/picklists/packinglistpdf?picklistId=${session.picklistId}`, '_blank')
  }

  return (
    <div className="px-3 py-3 lg:px-4 border-b border-border bg-card space-y-3">
      {/* Hero: Next Order / Batch Complete */}
      {nextPicklist ? (
        <button
          onClick={onNextPicklist}
          className="w-full bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 text-left hover:bg-emerald-100 hover:border-emerald-400 transition-colors group"
        >
          <div className="flex items-center gap-2 text-emerald-700 mb-1">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-medium">{t.completed.orderCompleted}</span>
            {batchProgress && (
              <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full ml-auto">
                {batchProgress.completed}/{batchProgress.total} {t.completed.batchProgress}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-bold text-emerald-900">{t.completed.nextOrder}</p>
              <p className="text-sm text-emerald-700">
                {nextPicklist.alias || nextPicklist.deliveryname || nextPicklist.picklistid}
                {nextPicklist.totalproducts > 0 && ` · ${nextPicklist.totalproducts} prod`}
              </p>
            </div>
            <ChevronRight className="w-6 h-6 text-emerald-600 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>
      ) : isBatchCompleted ? (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4">
          <div className="flex items-center gap-2 text-emerald-700 mb-1">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-sm font-medium">{t.completed.orderCompleted}</span>
          </div>
          <p className="text-lg font-bold text-emerald-900">{t.completed.batchCompleted}</p>
          <p className="text-sm text-emerald-700 mt-1">{t.completed.batchCompletedDesc}</p>
          <button
            onClick={onBackToBatches}
            className="mt-3 inline-flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors min-h-[48px]"
          >
            {t.completed.backToBatches}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <span className="text-lg font-bold text-emerald-900">{t.completed.orderCompleted}</span>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleDownloadAllLabels}
          disabled={shippedBoxes.filter((b) => b.labelUrl).length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors min-h-[40px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Printer className="w-4 h-4 text-muted-foreground" />
          {t.completed.reprintLabels}
        </button>
        <button
          onClick={onExtraShipment}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors min-h-[40px]"
        >
          <PackagePlus className="w-4 h-4 text-muted-foreground" />
          {t.completed.extraShipment}
        </button>
        <button
          onClick={handleDownloadPakbon}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors min-h-[40px]"
        >
          <FileText className="w-4 h-4 text-muted-foreground" />
          {t.completed.packingSlip}
        </button>
      </div>
    </div>
  )
}
