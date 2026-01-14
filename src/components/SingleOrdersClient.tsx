'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { History } from 'lucide-react'
import { useSingleOrders } from '@/hooks/useSingleOrders'
import { useSingleOrderFilters } from '@/hooks/useSingleOrderFilters'
import { usePresets } from '@/hooks/usePresets'
import { usePostalRegions } from '@/hooks/usePostalRegions'
import { ProductGroup } from '@/types/singleOrder'
import FilterPanel from '@/components/filters/FilterPanel'
import PresetsPanel from '@/components/presets/PresetsPanel'
import GroupedOrdersTable from '@/components/single-orders/GroupedOrdersTable'
import Footer from '@/components/layout/Footer'
import CreateShipmentsDialog from '@/components/ui/CreateShipmentsDialog'
import ProcessingIndicator from '@/components/ui/ProcessingIndicator'

interface BatchResult {
  success: boolean
  message: string
  batchId?: string
  validationErrors?: string[]
}

export default function SingleOrdersClient() {
  const { groups, totalSingleOrders, metadata, isLoading, error, refetch, fetchedAt } = useSingleOrders()
  const { regions: postalRegions } = usePostalRegions()
  const { filters, filteredGroups, updateFilter, resetFilters, applyPreset } = useSingleOrderFilters(groups, postalRegions)
  const { presets, isLoading: presetsLoading, removePreset, addPreset } = usePresets('single_order')
  const [selectedGroups, setSelectedGroups] = useState<ProductGroup[]>([])

  // Batch creation state
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
  const [isCreatingBatch, setIsCreatingBatch] = useState(false)
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
  const [newlyCreatedBatch, setNewlyCreatedBatch] = useState<{ batchId: string; totalOrders: number } | null>(null)

  const totalSelectedOrders = selectedGroups.reduce((sum, g) => sum + g.totalCount, 0)

  // Auto-dismiss success notification after 5 seconds
  useEffect(() => {
    if (batchResult?.success) {
      const timeout = setTimeout(() => {
        setBatchResult(null)
      }, 5000)
      return () => clearTimeout(timeout)
    }
  }, [batchResult])

  // Handler to open confirmation dialog (refresh data first)
  const handleCreateBatchClick = async () => {
    if (selectedGroups.length === 0) {
      setBatchResult({
        success: false,
        message: 'Selecteer eerst een of meer productgroepen',
      })
      return
    }

    setBatchResult(null)
    // Refresh data to get latest orders
    await refetch()
    setIsConfirmDialogOpen(true)
  }

  // Handler for actual batch creation
  const handleConfirmBatch = async (shippingProviderId: number, packagingId: number | null, name?: string) => {
    setIsCreatingBatch(true)

    try {
      // Prepare product groups for API, filtering out orders without a valid picklist
      const productGroupsPayload = selectedGroups.map(group => ({
        productId: group.productId,
        productCode: group.productCode,
        productName: group.productName,
        orders: group.orders
          .filter(order => order.idPicklist !== null && order.idPicklist !== undefined)
          .map(order => ({
            id: parseInt(order.id, 10),
            reference: order.reference,
            idPicklist: order.idPicklist as number,
            retailerName: order.retailerName,
            idShippingProvider: order.idShippingProvider,
            country: order.bezorgland,
          })),
      })).filter(group => group.orders.length > 0) // Remove empty groups

      if (productGroupsPayload.length === 0) {
        setBatchResult({
          success: false,
          message: 'Geen geldige orders gevonden met een picklist',
        })
        setIsCreatingBatch(false)
        setIsConfirmDialogOpen(false)
        return
      }

      const response = await fetch('/api/single-orders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productGroups: productGroupsPayload,
          idShippingProvider: shippingProviderId,
          idPackaging: packagingId,
          name,
        }),
      })

      const result = await response.json()

      if (result.success) {
        // Batch created successfully - close dialog immediately
        // Tell ProcessingIndicator about this batch immediately (bypass DB read replica lag)
        setNewlyCreatedBatch({
          batchId: result.batchId,
          totalOrders: result.totalOrders || totalSelectedOrders,
        })

        // Shipments are processing in background via ProcessingIndicator
        setBatchResult({
          success: true,
          message: `Batch ${result.batchId} aangemaakt! Shipments worden verwerkt...`,
          batchId: result.batchId,
        })
        setIsConfirmDialogOpen(false)
        setIsCreatingBatch(false)

        // Clear the newly created batch after 30 seconds (DB should have caught up by then)
        setTimeout(() => {
          setNewlyCreatedBatch(prev => prev?.batchId === result.batchId ? null : prev)
        }, 30000)

        // Refresh orders and clear selection
        await refetch()
        setSelectedGroups([])
      } else {
        // Handle validation errors specifically
        const message = result.validationErrors
          ? `Validatie mislukt: ${result.validationErrors.length} order(s) hebben een probleem`
          : result.error || 'Er is een fout opgetreden'

        setBatchResult({
          success: false,
          message,
          validationErrors: result.validationErrors,
        })
        setIsCreatingBatch(false)
        setIsConfirmDialogOpen(false)
      }
    } catch (err) {
      setBatchResult({
        success: false,
        message: err instanceof Error ? err.message : 'Er is een onbekende fout opgetreden',
      })
      setIsCreatingBatch(false)
      setIsConfirmDialogOpen(false)
    }
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="text-destructive font-semibold">Error loading single orders</div>
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
        {/* Header with history link */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Single Orders</h1>
          <Link
            href="/single-orders/history"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors border border-border"
          >
            <History className="w-4 h-4" />
            Bekijk geschiedenis
          </Link>
        </div>

        {/* Batch result message */}
        {batchResult && (
          <div
            className={`p-4 rounded-lg border ${
              batchResult.success
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{batchResult.message}</span>
                {batchResult.validationErrors && batchResult.validationErrors.length > 0 && (
                  <div className="mt-2 text-sm">
                    <details>
                      <summary className="cursor-pointer hover:underline">
                        Toon details ({batchResult.validationErrors.length} problemen)
                      </summary>
                      <ul className="mt-2 list-disc list-inside space-y-1 text-xs max-h-[200px] overflow-y-auto">
                        {batchResult.validationErrors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </div>
              <button
                onClick={() => setBatchResult(null)}
                className="text-current hover:opacity-70 self-start"
              >
                &times;
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <FilterPanel
            filters={filters}
            metadata={metadata}
            onFilterChange={updateFilter}
            onReset={resetFilters}
            isLoading={isLoading}
            hidePPS
            onCreatePreset={addPreset}
            onCreateBatch={handleCreateBatchClick}
            isCreatingBatch={isCreatingBatch}
            postalRegions={postalRegions}
          />
          <PresetsPanel
            presets={presets}
            onApplyPreset={applyPreset}
            onDeletePreset={removePreset}
            isLoading={presetsLoading}
            postalRegions={postalRegions}
          />
        </div>

        <GroupedOrdersTable
          groups={filteredGroups}
          isLoading={isLoading}
          onRefresh={refetch}
          totalSingleOrders={totalSingleOrders}
          selectedGroups={selectedGroups}
          onSelectionChange={setSelectedGroups}
        />
      </main>

      <Footer fetchedAt={fetchedAt} />

      {/* Create shipments dialog */}
      <CreateShipmentsDialog
        open={isConfirmDialogOpen}
        onClose={() => setIsConfirmDialogOpen(false)}
        onConfirm={handleConfirmBatch}
        totalOrders={totalSelectedOrders}
        totalGroups={selectedGroups.length}
        defaultShippingProviderId={selectedGroups[0]?.orders[0]?.idShippingProvider ?? null}
        firstPicklistId={selectedGroups[0]?.orders[0]?.idPicklist ?? null}
        isLoading={isCreatingBatch}
      />

      {/* Processing indicator for background batch processing */}
      <ProcessingIndicator newlyCreatedBatch={newlyCreatedBatch} />
    </>
  )
}
