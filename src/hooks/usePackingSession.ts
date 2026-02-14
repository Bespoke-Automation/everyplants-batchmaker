'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { BoxShipmentStatus } from '@/types/verpakking'

let tempIdCounter = 0

// Session types for the hook's internal use
interface SessionProduct {
  id: string
  boxId: string
  picqerProductId: number
  productcode: string
  productName: string
  amount: number
  weightPerUnit: number | null
}

interface SessionBox {
  id: string
  packagingName: string
  picqerPackagingId: number | null
  packagingBarcode: string | null
  boxIndex: number
  status: string
  shipmentId: number | null
  trackingCode: string | null
  trackingUrl: string | null
  labelUrl: string | null
  shippedAt: string | null
  suggestedPackagingId: number | null
  suggestedPackagingName: string | null
  wasOverride: boolean
  products: SessionProduct[]
}

interface Session {
  id: string
  picklistId: number
  workerId: number
  workerName: string
  status: string
  boxes: SessionBox[]
  createdAt: string
  updatedAt: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformProduct(raw: any): SessionProduct {
  return {
    id: raw.id,
    boxId: raw.box_id ?? raw.boxId,
    picqerProductId: raw.picqer_product_id ?? raw.picqerProductId,
    productcode: raw.productcode,
    productName: raw.product_name ?? raw.productName,
    amount: raw.amount,
    weightPerUnit: raw.weight_per_unit ?? raw.weightPerUnit ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformBox(raw: any): SessionBox {
  const products = raw.packing_session_products ?? raw.products ?? []
  return {
    id: raw.id,
    packagingName: raw.packaging_name ?? raw.packagingName,
    picqerPackagingId: raw.picqer_packaging_id ?? raw.picqerPackagingId ?? null,
    packagingBarcode: raw.packaging_barcode ?? raw.packagingBarcode ?? null,
    boxIndex: raw.box_index ?? raw.boxIndex,
    status: raw.status,
    shipmentId: raw.shipment_id ?? raw.shipmentId ?? null,
    trackingCode: raw.tracking_code ?? raw.trackingCode ?? null,
    trackingUrl: raw.tracking_url ?? raw.trackingUrl ?? null,
    labelUrl: raw.label_url ?? raw.labelUrl ?? null,
    shippedAt: raw.shipped_at ?? raw.shippedAt ?? null,
    suggestedPackagingId: raw.suggested_packaging_id ?? raw.suggestedPackagingId ?? null,
    suggestedPackagingName: raw.suggested_packaging_name ?? raw.suggestedPackagingName ?? null,
    wasOverride: raw.was_override ?? raw.wasOverride ?? false,
    products: products.map(transformProduct),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformSession(raw: any): Session {
  const boxes = raw.packing_session_boxes ?? raw.boxes ?? []
  return {
    id: raw.id,
    picklistId: raw.picklist_id ?? raw.picklistId,
    workerId: raw.assigned_to ?? raw.workerId,
    workerName: raw.assigned_to_name ?? raw.workerName,
    status: raw.status,
    boxes: boxes.map(transformBox),
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
  }
}

export function usePackingSession(sessionId: string | null) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [shipProgress, setShipProgress] = useState<Map<string, BoxShipmentStatus>>(new Map())
  const [warnings, setWarnings] = useState<string[]>([])
  const previousSessionRef = useRef<Session | null>(null)
  const sessionRef = useRef<Session | null>(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const fetchSession = useCallback(async (signal?: AbortSignal) => {
    if (!sessionId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/verpakking/sessions/${sessionId}`, { signal })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch session')
      }
      const data = await response.json()
      const sessionData = transformSession(data.session ?? data)
      setSession(sessionData)
      previousSessionRef.current = sessionData
      setIsLoading(false)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err : new Error('Unknown error'))
      setIsLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) {
      setSession(null)
      setIsLoading(false)
      return
    }

    const abortController = new AbortController()
    fetchSession(abortController.signal)
    return () => abortController.abort()
  }, [fetchSession, sessionId])

  // --- Box methods ---

  const addBox = useCallback(
    async (
      packagingName: string,
      picqerPackagingId?: number,
      packagingBarcode?: string,
      adviceMeta?: { packagingAdviceId?: string; suggestedPackagingId?: number; suggestedPackagingName?: string }
    ): Promise<string | undefined> => {
      if (!sessionId || !sessionRef.current) return undefined

      // Save snapshot for rollback (local variable is stable in this closure)
      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Compute next box index inside the state updater so it uses the latest
      // state even when multiple addBox calls run sequentially before React flushes.
      const tempId = `temp-${Date.now()}-${++tempIdCounter}`
      let computedIndex = 0

      setSession((prev) => {
        if (!prev) return prev
        computedIndex = prev.boxes.length > 0
          ? Math.max(...prev.boxes.map((b) => b.boxIndex)) + 1
          : 0
        const optimisticBox: SessionBox = {
          id: tempId,
          packagingName,
          picqerPackagingId: picqerPackagingId ?? null,
          packagingBarcode: packagingBarcode ?? null,
          boxIndex: computedIndex,
          status: 'pending',
          shipmentId: null,
          trackingCode: null,
          trackingUrl: null,
          labelUrl: null,
          shippedAt: null,
          suggestedPackagingId: adviceMeta?.suggestedPackagingId ?? null,
          suggestedPackagingName: adviceMeta?.suggestedPackagingName ?? null,
          wasOverride: false,
          products: [],
        }
        return { ...prev, boxes: [...prev.boxes, optimisticBox] }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/boxes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packagingName,
            picqerPackagingId,
            packagingBarcode,
            boxIndex: computedIndex,
            packagingAdviceId: adviceMeta?.packagingAdviceId,
            suggestedPackagingId: adviceMeta?.suggestedPackagingId,
            suggestedPackagingName: adviceMeta?.suggestedPackagingName,
          }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to add box')
        }
        const data = await response.json()
        // Replace temp box with server response
        const serverBox = transformBox(data.box ?? data)
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) => (b.id === tempId ? serverBox : b)),
          }
        })
        return serverBox.id
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
        return undefined
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const updateBox = useCallback(
    async (boxId: string, updates: Partial<SessionBox>) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically update
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.map((b) => (b.id === boxId ? { ...b, ...updates } : b)),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/boxes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId, ...updates }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update box')
        }
        const data = await response.json()
        const serverBox = transformBox(data.box ?? data)
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === boxId ? { ...serverBox, products: serverBox.products.length > 0 ? serverBox.products : b.products } : b
            ),
          }
        })
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const removeBox = useCallback(
    async (boxId: string) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically remove
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.filter((b) => b.id !== boxId),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/boxes`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to remove box')
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  // --- Product methods ---

  const assignProduct = useCallback(
    async (
      boxId: string,
      product: {
        picqerProductId: number
        productcode: string
        productName: string
        amount: number
        weightPerUnit?: number
      }
    ) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically add product to the correct box
      const tempId = `temp-prod-${Date.now()}-${++tempIdCounter}`
      const optimisticProduct: SessionProduct = {
        id: tempId,
        boxId,
        picqerProductId: product.picqerProductId,
        productcode: product.productcode,
        productName: product.productName,
        amount: product.amount,
        weightPerUnit: product.weightPerUnit ?? null,
      }
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.map((b) =>
            b.id === boxId ? { ...b, products: [...b.products, optimisticProduct] } : b
          ),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId, ...product }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to assign product')
        }
        const data = await response.json()
        const serverProduct = transformProduct(data.product ?? data)
        // Replace temp product with server response
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === boxId
                ? {
                    ...b,
                    products: b.products.map((p) =>
                      p.id === tempId ? serverProduct : p
                    ),
                  }
                : b
            ),
          }
        })

        // Capture warning from API response (e.g. Picqer pick failed)
        if (data.warning) {
          setWarnings((prev) => [...prev, data.warning])
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const moveProduct = useCallback(
    async (productId: string, newBoxId: string) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically move product between boxes
      setSession((prev) => {
        if (!prev) return prev
        let movedProduct: SessionProduct | null = null
        const boxesWithoutProduct = prev.boxes.map((b) => {
          const product = b.products.find((p) => p.id === productId)
          if (product) {
            movedProduct = { ...product, boxId: newBoxId }
            return { ...b, products: b.products.filter((p) => p.id !== productId) }
          }
          return b
        })
        if (!movedProduct) return prev
        const finalProduct = movedProduct
        return {
          ...prev,
          boxes: boxesWithoutProduct.map((b) =>
            b.id === newBoxId ? { ...b, products: [...b.products, finalProduct] } : b
          ),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/products`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, boxId: newBoxId }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to move product')
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const updateProductAmount = useCallback(
    async (productId: string, newAmount: number) => {
      if (!sessionId || !sessionRef.current) return

      // If amount drops to 0, remove the product entirely
      if (newAmount <= 0) {
        // We call the internal logic below via removeProduct after defining it
        // For now, just optimistic-remove and API-delete
        const snapshot = sessionRef.current
        previousSessionRef.current = sessionRef.current
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) => ({
              ...b,
              products: b.products.filter((p) => p.id !== productId),
            })),
          }
        })
        setIsSaving(true)
        try {
          const response = await fetch(`/api/verpakking/sessions/${sessionId}/products`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId }),
          })
          if (!response.ok) {
            const errorData = await response.json()
            throw new Error(errorData.error || 'Failed to remove product')
          }
        } catch (err) {
          setSession(snapshot)
          setError(err instanceof Error ? err : new Error('Operation failed'))
        } finally {
          setIsSaving(false)
        }
        return
      }

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically update amount
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.map((b) => ({
            ...b,
            products: b.products.map((p) =>
              p.id === productId ? { ...p, amount: newAmount } : p
            ),
          })),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/products`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId, amount: newAmount }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update product amount')
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const removeProduct = useCallback(
    async (productId: string) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      // Optimistically remove product from its box
      setSession((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          boxes: prev.boxes.map((b) => ({
            ...b,
            products: b.products.filter((p) => p.id !== productId),
          })),
        }
      })

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/products`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to remove product')
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  // --- Shipping methods ---

  const shipBox = useCallback(
    async (boxId: string, shippingProviderId: number, packagingId?: number, weight?: number) => {
      if (!sessionId) return

      setShipProgress((prev) => {
        const next = new Map(prev)
        next.set(boxId, { boxId, status: 'shipping' })
        return next
      })

      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/ship`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId, shippingProviderId, packagingId: packagingId ?? null, weight: weight ?? null }),
        })
        const data = await response.json()

        if (!response.ok) {
          setShipProgress((prev) => {
            const next = new Map(prev)
            next.set(boxId, { boxId, status: 'error', error: data.error || 'Shipment failed' })
            return next
          })
          return
        }

        setShipProgress((prev) => {
          const next = new Map(prev)
          next.set(boxId, {
            boxId,
            status: 'shipped',
            trackingCode: data.trackingCode,
            labelUrl: data.labelUrl,
            warning: data.warning,
            sessionCompleted: data.sessionCompleted,
          })
          return next
        })

        // If the API returned a warning, also add it to the global warnings list
        if (data.warning) {
          setWarnings((prev) => [...prev, data.warning])
        }

        // Update box status in session
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === boxId ? {
                ...b,
                status: 'shipped',
                shipmentId: data.shipmentId ?? null,
                trackingCode: data.trackingCode ?? null,
                trackingUrl: data.trackingUrl ?? null,
                labelUrl: data.labelUrl ?? null,
                shippedAt: new Date().toISOString(),
              } : b
            ),
          }
        })

        // If session completed, update session status locally
        if (data.sessionCompleted) {
          setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        setShipProgress((prev) => {
          const next = new Map(prev)
          next.set(boxId, { boxId, status: 'error', error: message })
          return next
        })
      }
    },
    [sessionId]
  )

  const cancelBoxShipment = useCallback(
    async (boxId: string) => {
      if (!sessionId) return { success: false, error: 'No session' }

      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/ship`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxId }),
        })
        const data = await response.json()

        if (!response.ok) {
          return { success: false, error: data.error || 'Failed to cancel shipment' }
        }

        // Update local state — box goes back to 'closed', clear shipment fields
        setSession((prev) => {
          if (!prev) return prev
          const updatedBoxes = prev.boxes.map((b) =>
            b.id === boxId ? {
              ...b,
              status: 'closed',
              shipmentId: null,
              trackingCode: null,
              trackingUrl: null,
              labelUrl: null,
              shippedAt: null,
            } : b
          )
          // If session was completed, reopen it
          const newStatus = data.sessionReopened ? 'shipping' : prev.status
          return { ...prev, status: newStatus, boxes: updatedBoxes }
        })

        // Clear from shipProgress
        setShipProgress((prev) => {
          const next = new Map(prev)
          next.delete(boxId)
          return next
        })

        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
    [sessionId]
  )

  const shipAllBoxes = useCallback(
    async (shippingProviderId: number, boxWeights?: Map<string, number>) => {
      const currentSession = sessionRef.current
      if (!sessionId || !currentSession) return

      const pendingBoxes = currentSession.boxes.filter((b) => b.status === 'closed')
      if (pendingBoxes.length === 0) return

      // Set all pending boxes to 'shipping' state
      for (const box of pendingBoxes) {
        setShipProgress((prev) => {
          const next = new Map(prev)
          next.set(box.id, { boxId: box.id, status: 'shipping' })
          return next
        })
      }

      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/ship-all`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shippingProviderId,
            boxWeights: boxWeights ? Object.fromEntries(boxWeights) : undefined,
          }),
        })
        const data = await response.json()

        if (!response.ok) {
          // Mark all boxes as error
          for (const box of pendingBoxes) {
            setShipProgress((prev) => {
              const next = new Map(prev)
              next.set(box.id, { boxId: box.id, status: 'error', error: data.error || 'Verzenden mislukt' })
              return next
            })
          }
          return
        }

        // Process per-box results
        const boxResults = data.boxes as Array<{
          boxId: string; success: boolean; trackingCode?: string; trackingUrl?: string; labelUrl?: string; error?: string
        }>

        for (const result of boxResults) {
          if (result.success) {
            setShipProgress((prev) => {
              const next = new Map(prev)
              next.set(result.boxId, {
                boxId: result.boxId,
                status: 'shipped',
                trackingCode: result.trackingCode,
                labelUrl: result.labelUrl,
                sessionCompleted: data.sessionCompleted,
              })
              return next
            })

            // Update box in session state
            setSession((prev) => {
              if (!prev) return prev
              return {
                ...prev,
                boxes: prev.boxes.map((b) =>
                  b.id === result.boxId ? {
                    ...b,
                    status: 'shipped',
                    shipmentId: null, // We don't get the ID back per-box in ship-all
                    trackingCode: result.trackingCode ?? null,
                    trackingUrl: result.trackingUrl ?? null,
                    labelUrl: result.labelUrl ?? null,
                    shippedAt: new Date().toISOString(),
                  } : b
                ),
              }
            })
          } else {
            setShipProgress((prev) => {
              const next = new Map(prev)
              next.set(result.boxId, {
                boxId: result.boxId,
                status: 'error',
                error: result.error || 'Verzenden mislukt',
              })
              return next
            })
          }
        }

        // Store multicollo info in first box's progress
        if (data.multicollo && boxResults.length > 0) {
          setShipProgress((prev) => {
            const next = new Map(prev)
            const first = next.get(boxResults[0].boxId)
            if (first) {
              next.set(first.boxId, { ...first, multicollo: true } as BoxShipmentStatus & { multicollo?: boolean })
            }
            return next
          })
        }

        if (data.warning) {
          setWarnings((prev) => [...prev, data.warning])
        }

        if (data.sessionCompleted) {
          setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        for (const box of pendingBoxes) {
          setShipProgress((prev) => {
            const next = new Map(prev)
            next.set(box.id, { boxId: box.id, status: 'error', error: message })
            return next
          })
        }
      }
    },
    [sessionId]
  )

  // --- Session methods ---

  const updateStatus = useCallback(
    async (status: string) => {
      if (!sessionId || !sessionRef.current) return

      const snapshot = sessionRef.current
      previousSessionRef.current = sessionRef.current

      setSession((prev) => (prev ? { ...prev, status } : prev))

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to update session status')
        }
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId]
  )

  const completeSession = useCallback(() => updateStatus('completed'), [updateStatus])

  const refetch = useCallback(() => fetchSession(), [fetchSession])

  const clearWarnings = useCallback(() => setWarnings([]), [])

  const dismissWarning = useCallback((index: number) => {
    setWarnings((prev) => prev.filter((_, i) => i !== index))
  }, [])

  return {
    session,
    isLoading,
    error,
    isSaving,
    shipProgress,
    warnings,
    addBox,
    updateBox,
    removeBox,
    assignProduct,
    moveProduct,
    updateProductAmount,
    removeProduct,
    shipBox,
    shipAllBoxes,
    cancelBoxShipment,
    updateStatus,
    completeSession,
    refetch,
    clearWarnings,
    dismissWarning,
  }
}
