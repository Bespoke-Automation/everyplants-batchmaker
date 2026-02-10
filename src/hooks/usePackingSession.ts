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
  const previousSessionRef = useRef<Session | null>(null)

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
    async (packagingName: string, picqerPackagingId?: number, packagingBarcode?: string) => {
      if (!sessionId || !session) return

      // Save snapshot for rollback (local variable is stable in this closure)
      const snapshot = session
      previousSessionRef.current = session

      // Determine next box index
      const nextIndex = session.boxes.length > 0
        ? Math.max(...session.boxes.map((b) => b.boxIndex)) + 1
        : 0

      // Optimistically add box
      const tempId = `temp-${Date.now()}-${++tempIdCounter}`
      const optimisticBox: SessionBox = {
        id: tempId,
        packagingName,
        picqerPackagingId: picqerPackagingId ?? null,
        packagingBarcode: packagingBarcode ?? null,
        boxIndex: nextIndex,
        status: 'pending',
        products: [],
      }
      setSession((prev) =>
        prev ? { ...prev, boxes: [...prev.boxes, optimisticBox] } : prev
      )

      setIsSaving(true)
      try {
        const response = await fetch(`/api/verpakking/sessions/${sessionId}/boxes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packagingName, picqerPackagingId, packagingBarcode, boxIndex: nextIndex }),
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
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId, session]
  )

  const updateBox = useCallback(
    async (boxId: string, updates: Partial<SessionBox>) => {
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
    [sessionId, session]
  )

  const removeBox = useCallback(
    async (boxId: string) => {
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
    [sessionId, session]
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
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
      } catch (err) {
        setSession(snapshot)
        setError(err instanceof Error ? err : new Error('Operation failed'))
      } finally {
        setIsSaving(false)
      }
    },
    [sessionId, session]
  )

  const moveProduct = useCallback(
    async (productId: string, newBoxId: string) => {
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
    [sessionId, session]
  )

  const removeProduct = useCallback(
    async (productId: string) => {
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
    [sessionId, session]
  )

  // --- Shipping methods ---

  const shipBox = useCallback(
    async (boxId: string, shippingProviderId: number, packagingId?: number) => {
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
          body: JSON.stringify({ boxId, shippingProviderId, packagingId: packagingId ?? null }),
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
          })
          return next
        })

        // Update box status in session
        setSession((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            boxes: prev.boxes.map((b) =>
              b.id === boxId ? { ...b, status: 'shipped' } : b
            ),
          }
        })
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

  const shipAllBoxes = useCallback(
    async (shippingProviderId: number) => {
      if (!session) return

      const pendingBoxes = session.boxes.filter((b) => b.status === 'pending')
      for (const box of pendingBoxes) {
        await shipBox(box.id, shippingProviderId, box.picqerPackagingId ?? undefined)
      }
    },
    [session, shipBox]
  )

  // --- Session methods ---

  const updateStatus = useCallback(
    async (status: string) => {
      if (!sessionId || !session) return

      const snapshot = session
      previousSessionRef.current = session

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
    [sessionId, session]
  )

  const completeSession = useCallback(() => updateStatus('completed'), [updateStatus])

  const refetch = useCallback(() => fetchSession(), [fetchSession])

  return {
    session,
    isLoading,
    error,
    isSaving,
    shipProgress,
    addBox,
    updateBox,
    removeBox,
    assignProduct,
    moveProduct,
    removeProduct,
    shipBox,
    shipAllBoxes,
    updateStatus,
    completeSession,
    refetch,
  }
}
