'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useBatchHistory } from '@/hooks/useBatchHistory'
import { EnrichedBatch } from '@/lib/supabase/shipmentLabels'
import BatchHistoryTable from '@/components/single-orders/BatchHistoryTable'

function generatePicklistHtml(items: Array<{ batchNumbers: string[]; productName: string; productCode: string; totalAmount: number; stockLocation: string | null }>, allBatchNumbers: string[]): string {
  const date = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long', timeStyle: 'short' }).format(new Date())
  const totalProducts = items.length
  const totalItems = items.reduce((sum, item) => sum + item.totalAmount, 0)

  const rows = items.map(item => `
    <tr>
      <td>${item.batchNumbers.join(', ')}</td>
      <td>
        <strong>${item.productName}</strong>
        <br><span class="code">${item.productCode}</span>
      </td>
      <td class="amount">${item.totalAmount}</td>
      <td>${item.stockLocation || '-'}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <title>Picklijst - ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #1a1a1a; }
    h1 { font-size: 20px; margin-bottom: 4px; }
    .meta { font-size: 12px; color: #666; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f3f4f6; text-align: left; padding: 8px 12px; border: 1px solid #d1d5db; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 6px 12px; border: 1px solid #e5e7eb; vertical-align: top; }
    tr:nth-child(even) { background: #f9fafb; }
    .code { font-family: monospace; font-size: 11px; color: #666; }
    .amount { text-align: center; font-weight: 600; font-size: 15px; }
    .footer { margin-top: 16px; font-size: 12px; color: #666; display: flex; gap: 24px; }
    @media print {
      body { padding: 12px; }
      tr:nth-child(even) { background: #f9fafb !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      th { background: #f3f4f6 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <h1>Picklijst</h1>
  <div class="meta">${date} &mdash; Batches: ${allBatchNumbers.join(', ')}</div>
  <table>
    <thead>
      <tr>
        <th style="width:15%">Batch #</th>
        <th style="width:45%">Producten</th>
        <th style="width:15%">Aantallen</th>
        <th style="width:25%">Locatie</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">
    <span><strong>${totalProducts}</strong> producten</span>
    <span><strong>${totalItems}</strong> stuks totaal</span>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`
}

export default function BatchHistoryClient() {
  const {
    batches,
    totalCount,
    page,
    totalPages,
    isLoading,
    error,
    goToPage,
    refetch,
  } = useBatchHistory()

  const [selectedBatches, setSelectedBatches] = useState<EnrichedBatch[]>([])
  const [isCreatingPicklist, setIsCreatingPicklist] = useState(false)

  const handlePageChange = useCallback((newPage: number) => {
    setSelectedBatches([])
    goToPage(newPage)
  }, [goToPage])

  const handleCreatePicklist = useCallback(async () => {
    if (selectedBatches.length === 0) return

    setIsCreatingPicklist(true)
    try {
      // Collect all unique Picqer batch IDs
      const picqerBatchIds: number[] = []
      for (const batch of selectedBatches) {
        if (batch.picqer_batch_ids && batch.picqer_batch_ids.length > 0) {
          for (const id of batch.picqer_batch_ids) {
            if (!picqerBatchIds.includes(id)) picqerBatchIds.push(id)
          }
        } else if (batch.picqer_batch_id) {
          if (!picqerBatchIds.includes(batch.picqer_batch_id)) picqerBatchIds.push(batch.picqer_batch_id)
        }
      }

      if (picqerBatchIds.length === 0) {
        alert('Geen Picqer batch IDs gevonden voor de geselecteerde batches.')
        return
      }

      const response = await fetch('/api/single-orders/picklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ picqerBatchIds }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Picklijst ophalen mislukt')
      }

      const data = await response.json()
      const allBatchNumbers = selectedBatches
        .map(b => b.picqer_batch_number || b.batch_id.slice(0, 8))
        .filter(Boolean)

      const html = generatePicklistHtml(data.items, allBatchNumbers)
      const printWindow = window.open('', '_blank')
      if (printWindow) {
        printWindow.document.write(html)
        printWindow.document.close()
      }
    } catch (error) {
      console.error('Picklist creation failed:', error)
      alert(`Picklijst aanmaken mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`)
    } finally {
      setIsCreatingPicklist(false)
    }
  }, [selectedBatches])

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
          href="/batchmaker/single-orders"
          className="inline-flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Terug naar Single Orders
        </Link>
      </div>

      {/* Batch history table */}
      <BatchHistoryTable
        batches={batches}
        isLoading={isLoading}
        onRefresh={refetch}
        page={page}
        totalPages={totalPages}
        totalCount={totalCount}
        onPageChange={handlePageChange}
        selectedBatches={selectedBatches}
        onSelectionChange={setSelectedBatches}
        onCreatePicklist={handleCreatePicklist}
        isCreatingPicklist={isCreatingPicklist}
      />
    </main>
  )
}
