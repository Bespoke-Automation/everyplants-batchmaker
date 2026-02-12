'use client'

import { useState } from 'react'
import { useOrders } from '@/hooks/useOrders'
import { useFilters } from '@/hooks/useFilters'
import { usePresets } from '@/hooks/usePresets'
import { usePostalRegions } from '@/hooks/usePostalRegions'
import FilterPanel from '@/components/filters/FilterPanel'
import PresetsPanel from '@/components/presets/PresetsPanel'
import OrdersTable from '@/components/orders/OrdersTable'
import Footer from '@/components/layout/Footer'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import BatchCreationNotification, { type BatchCreationResult } from '@/components/ui/BatchCreationNotification'

export default function BatchmakerClient() {
  const { orders, metadata, total, isLoading, error, refetch, fetchedAt } = useOrders()
  const { regions: postalRegions } = usePostalRegions()
  const { filters, filteredOrders, updateFilter, resetFilters, applyPreset, sortOrder, maxResults, updateSortOrder, updateMaxResults } = useFilters(orders, postalRegions)
  const { presets, isLoading: presetsLoading, removePreset, addPreset } = usePresets('batch')

  // Batch creation state
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [isCreatingBatch, setIsCreatingBatch] = useState(false)
  const [latestBatchCreation, setLatestBatchCreation] = useState<BatchCreationResult | null>(null)

  // Get eligible picklist IDs from filtered orders
  const getEligiblePicklistIds = (): number[] => {
    return filteredOrders
      .filter(order => !order.isPartOfBatch && order.picklistStatus === 'new' && order.idPicklist !== null)
      .map(order => order.idPicklist as number)
  }

  // Handler to open confirmation dialog (refresh data first)
  const handleCreateBatchClick = async () => {
    // Refresh data to get latest orders
    await refetch()
    setIsConfirmDialogOpen(true)
  }

  // Handler for actual batch creation
  const handleConfirmBatch = async () => {
    setIsCreatingBatch(true)

    try {
      const picklistIds = getEligiblePicklistIds()

      if (picklistIds.length === 0) {
        setLatestBatchCreation({
          success: false,
          picklistCount: 0,
          webhookTriggered: false,
          ppsFilter: filters.pps as 'ja' | 'nee',
          errorMessage: 'Geen picklists gevonden om aan batch toe te voegen',
        })
        setIsConfirmDialogOpen(false)
        setIsCreatingBatch(false)
        return
      }

      const response = await fetch('/api/batches/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          picklistIds,
          ppsFilter: filters.pps,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setLatestBatchCreation({
          success: true,
          batchId: result.batchId,
          picklistCount: result.picklistCount,
          webhookTriggered: result.webhookTriggered,
          ppsFilter: filters.pps as 'ja' | 'nee',
        })
        // Refresh orders to show updated batch status
        await refetch()
      } else {
        setLatestBatchCreation({
          success: false,
          picklistCount: 0,
          webhookTriggered: false,
          ppsFilter: filters.pps as 'ja' | 'nee',
          errorMessage: result.error || 'Er is een fout opgetreden',
        })
      }
    } catch (err) {
      setLatestBatchCreation({
        success: false,
        picklistCount: 0,
        webhookTriggered: false,
        ppsFilter: filters.pps as 'ja' | 'nee',
        errorMessage: err instanceof Error ? err.message : 'Er is een onbekende fout opgetreden',
      })
    } finally {
      setIsCreatingBatch(false)
      setIsConfirmDialogOpen(false)
    }
  }

  const eligiblePicklistCount = getEligiblePicklistIds().length

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-destructive font-semibold">Error loading orders</div>
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <>
      <main className="flex-1 p-6 space-y-6 overflow-auto">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <FilterPanel
            filters={filters}
            metadata={metadata}
            onFilterChange={updateFilter}
            onReset={resetFilters}
            isLoading={isLoading}
            onCreatePreset={addPreset}
            onCreateBatch={handleCreateBatchClick}
            isCreatingBatch={isCreatingBatch}
            postalRegions={postalRegions}
            sortOrder={sortOrder}
            maxResults={maxResults}
            onSortOrderChange={updateSortOrder}
            onMaxResultsChange={updateMaxResults}
          />
          <PresetsPanel
            presets={presets}
            onApplyPreset={applyPreset}
            onDeletePreset={removePreset}
            isLoading={presetsLoading}
            postalRegions={postalRegions}
          />
        </div>

        <OrdersTable
          orders={filteredOrders}
          isLoading={isLoading}
          onRefresh={refetch}
          total={total}
        />
      </main>

      <Footer fetchedAt={fetchedAt} />

      {/* Batch creation notification popup */}
      <BatchCreationNotification latestResult={latestBatchCreation} />

      {/* Batch confirmation dialog */}
      <ConfirmDialog
        open={isConfirmDialogOpen}
        onClose={() => setIsConfirmDialogOpen(false)}
        onConfirm={handleConfirmBatch}
        title="Batch aanmaken"
        message={`${eligiblePicklistCount} picklists worden toegevoegd aan een nieuwe batch. Weet je zeker dat je door wilt gaan?`}
        confirmText="Batch aanmaken"
        cancelText="Annuleren"
        isLoading={isCreatingBatch}
      />
    </>
  )
}
