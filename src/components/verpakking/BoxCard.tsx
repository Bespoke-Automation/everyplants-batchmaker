'use client'

import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  Box,
  Check,
  Truck,
  X,
  Lock,
  Unlock,
  Package,
  Weight,
  Trash2,
  Minus,
  Plus,
  ExternalLink,
  FileText,
  XCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react'

// Lightweight product type for display within a box
export interface BoxProductItem {
  id: string
  productCode: string
  name: string
  amount: number
  maxAmount: number // max this product can be in this box (current + unassigned)
  weight: number // grams
  imageUrl: string | null
}

// Lightweight box type for display
export interface BoxCardItem {
  id: string
  packagingName: string
  packagingImageUrl: string | null
  picqerPackagingId: number | null
  products: BoxProductItem[]
  isClosed: boolean
  shipmentCreated: boolean
  trackingCode: string | null
  trackingUrl: string | null
  labelUrl: string | null
  shippedAt: string | null
}

interface BoxCardProps {
  box: BoxCardItem
  index: number
  onRemoveProduct: (productId: string) => void
  onUpdateProductAmount: (productId: string, newAmount: number) => void
  onCloseBox: () => void
  onReopenBox: () => void
  onRemoveBox: () => void
  onCreateShipment: () => void
  onCancelShipment?: () => void
  onAssignAllProducts?: () => void
  unassignedProductCount?: number
}

export default function BoxCard({
  box,
  index,
  onRemoveProduct,
  onUpdateProductAmount,
  onCloseBox,
  onReopenBox,
  onRemoveBox,
  onCreateShipment,
  onCancelShipment,
  onAssignAllProducts,
  unassignedProductCount = 0,
}: BoxCardProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: box.id,
    disabled: box.isClosed,
  })

  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [cancelTimeLeft, setCancelTimeLeft] = useState<number | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const stepperRef = useRef<HTMLDivElement>(null)

  // Cancel countdown timer (5 minutes from shipped_at)
  useEffect(() => {
    if (!box.shippedAt) {
      setCancelTimeLeft(null)
      return
    }

    const updateCountdown = () => {
      const elapsed = Date.now() - new Date(box.shippedAt!).getTime()
      const remaining = 5 * 60 * 1000 - elapsed
      setCancelTimeLeft(remaining > 0 ? remaining : 0)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [box.shippedAt])

  // Close stepper on click outside
  useEffect(() => {
    if (!editingProductId) return

    function handleClickOutside(e: MouseEvent) {
      if (stepperRef.current && !stepperRef.current.contains(e.target as Node)) {
        setEditingProductId(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editingProductId])

  const totalWeight = box.products.reduce((sum, p) => sum + p.weight, 0)

  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg overflow-hidden transition-all ${
        box.shipmentCreated
          ? 'border-green-300 bg-green-50/30'
          : box.isClosed
          ? 'border-blue-300 bg-blue-50/30'
          : isOver
          ? 'border-primary border-2 bg-primary/5 shadow-lg'
          : 'border-border bg-card hover:border-primary/30'
      }`}
    >
      {/* Box header */}
      <div className="flex items-center gap-3 p-3 border-b border-border bg-muted/30">
        {/* Box icon / image */}
        {box.packagingImageUrl ? (
          <img
            src={box.packagingImageUrl}
            alt={box.packagingName}
            className="w-14 h-14 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-14 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
            <Box className="w-7 h-7 text-muted-foreground" />
          </div>
        )}

        {/* Box info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Doos {index}</h3>
            {box.shipmentCreated ? (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 rounded-full flex items-center gap-1">
                <Truck className="w-3 h-3" />
                Zending gemaakt
              </span>
            ) : box.isClosed ? (
              <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 rounded-full flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Afgesloten
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{box.packagingName}</p>
          {!box.picqerPackagingId && !box.shipmentCreated && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3" />
              Geen Picqer ID — zending niet mogelijk
            </p>
          )}
        </div>

        {/* Remove box button (only if empty and not closed) */}
        {box.products.length === 0 && !box.isClosed && (
          <button
            onClick={onRemoveBox}
            className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            title="Verwijder doos"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Weight indicator */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Weight className="w-3 h-3" />
            Gewicht
          </span>
          <span>
            {(totalWeight / 1000).toFixed(2)} kg
          </span>
        </div>
      </div>

      {/* Products in box */}
      <div className="p-3">
        {box.products.length === 0 ? (
          <div className="space-y-2">
            {/* Assign all button — prominent when box is empty */}
            {!box.isClosed && unassignedProductCount > 0 && onAssignAllProducts && (
              <button
                onClick={onAssignAllProducts}
                className="w-full flex items-center justify-center gap-2 py-3 min-h-[48px] bg-primary/10 text-primary border border-primary/30 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                <Package className="w-4 h-4" />
                Alle producten toewijzen ({unassignedProductCount})
              </button>
            )}
            <div className={`py-6 text-center border-2 border-dashed rounded-lg ${
              isOver ? 'border-primary bg-primary/10' : 'border-border'
            }`}>
              <Box className={`w-8 h-8 mx-auto mb-2 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className={`text-sm ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {isOver ? 'Laat los om toe te voegen' : 'Sleep producten hierheen'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Producten ({box.products.length})
            </p>
            {box.products.map((product) => {
              const isEditing = editingProductId === product.id

              return (
                <div
                  key={product.id}
                  className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg"
                >
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-8 h-8 rounded object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 bg-muted rounded flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {isEditing && !box.isClosed ? (
                      <div ref={stepperRef} className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const newAmount = product.amount - 1
                            if (newAmount <= 0) {
                              onRemoveProduct(product.id)
                              setEditingProductId(null)
                            } else {
                              onUpdateProductAmount(product.id, newAmount)
                            }
                          }}
                          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                            product.amount <= 1
                              ? 'bg-red-100 text-red-600 hover:bg-red-200'
                              : 'bg-muted hover:bg-muted/80 text-foreground'
                          }`}
                          title={product.amount <= 1 ? 'Verwijder uit doos' : 'Eén minder'}
                        >
                          {product.amount <= 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                        </button>
                        <span className="min-w-[36px] text-center font-semibold text-base tabular-nums">
                          {product.amount}
                        </span>
                        <button
                          onClick={() => {
                            if (product.amount < product.maxAmount) {
                              onUpdateProductAmount(product.id, product.amount + 1)
                            }
                          }}
                          disabled={product.amount >= product.maxAmount}
                          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${
                            product.amount >= product.maxAmount
                              ? 'bg-muted text-muted-foreground cursor-not-allowed'
                              : 'bg-muted hover:bg-muted/80 text-foreground'
                          }`}
                          title={product.amount >= product.maxAmount ? 'Maximum bereikt' : 'Eén meer'}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <p className="text-sm truncate ml-1">{product.name}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        {!box.isClosed ? (
                          <button
                            onClick={() => setEditingProductId(product.id)}
                            className="inline-flex items-center justify-center min-w-[40px] min-h-[32px] px-2 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary font-semibold text-sm hover:bg-primary/10 hover:border-primary/50 transition-colors flex-shrink-0"
                            title="Aantal aanpassen"
                          >
                            {product.amount}x
                          </button>
                        ) : (
                          <span className="inline-flex items-center justify-center min-w-[40px] px-2 py-1 rounded-md bg-muted text-sm font-semibold flex-shrink-0">
                            {product.amount}x
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.productCode} {product.weight > 0 ? `· ${(product.weight / 1000).toFixed(2)} kg` : ''}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {!box.isClosed && !isEditing && (
                    <button
                      onClick={() => onRemoveProduct(product.id)}
                      className="p-2 text-muted-foreground hover:text-red-500 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center -mr-1"
                      title="Verwijder uit doos"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            })}

            {/* Assign remaining + drop zone at bottom when products exist */}
            {!box.isClosed && (
              <div className="space-y-2">
                {unassignedProductCount > 0 && onAssignAllProducts && (
                  <button
                    onClick={onAssignAllProducts}
                    className="w-full flex items-center justify-center gap-2 py-2 min-h-[44px] text-primary text-xs font-medium hover:bg-primary/10 rounded-lg transition-colors"
                  >
                    <Package className="w-3.5 h-3.5" />
                    Rest toewijzen ({unassignedProductCount} producten)
                  </button>
                )}
                <div className={`py-3 text-center border-2 border-dashed rounded-lg transition-all ${
                  isOver ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border'
                }`}>
                  <p className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    {isOver ? 'Laat los om toe te voegen' : '+ Sleep meer producten'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Box actions */}
      <div className="px-3 pb-3 flex flex-col gap-2">
        {box.shipmentCreated ? (
          <div className="space-y-2">
            {/* Tracking info */}
            <div className="flex items-center gap-2 py-2 px-3 bg-green-100 text-green-800 rounded-lg text-sm">
              <Check className="w-4 h-4 flex-shrink-0" />
              <span className="font-medium">Zending aangemaakt</span>
              {box.shippedAt && (
                <span className="text-xs text-green-600 ml-auto">
                  {new Date(box.shippedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            {box.trackingCode && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-lg text-xs">
                <Truck className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                {box.trackingUrl ? (
                  <a
                    href={box.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-sm text-primary hover:underline"
                  >
                    {box.trackingCode}
                  </a>
                ) : (
                  <span className="font-mono text-sm">{box.trackingCode}</span>
                )}
              </div>
            )}
            {/* Actions row: label + cancel */}
            <div className="flex gap-2">
              {box.labelUrl && (
                <a
                  href={box.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-2 py-2 min-h-[44px] border border-border rounded-lg text-sm hover:bg-muted transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Open label
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {onCancelShipment && cancelTimeLeft !== null && cancelTimeLeft > 0 && (
                <button
                  onClick={async () => {
                    setIsCancelling(true)
                    try {
                      await onCancelShipment()
                    } finally {
                      setIsCancelling(false)
                    }
                  }}
                  disabled={isCancelling}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  {isCancelling ? (
                    <Clock className="w-4 h-4 animate-spin" />
                  ) : (
                    <XCircle className="w-4 h-4" />
                  )}
                  <span className="tabular-nums">
                    {Math.floor(cancelTimeLeft / 60000)}:{String(Math.floor((cancelTimeLeft % 60000) / 1000)).padStart(2, '0')}
                  </span>
                </button>
              )}
            </div>
          </div>
        ) : box.isClosed ? (
          <>
            <button
              onClick={onReopenBox}
              className="flex-1 flex items-center justify-center gap-2 py-2 min-h-[44px] border border-border rounded-lg text-sm hover:bg-muted transition-colors"
            >
              <Unlock className="w-4 h-4" />
              Heropenen
            </button>
            <button
              onClick={onCreateShipment}
              className="flex-1 flex items-center justify-center gap-2 py-2 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Truck className="w-4 h-4" />
              Maak zending
            </button>
          </>
        ) : (
          <button
            onClick={onCloseBox}
            disabled={box.products.length === 0}
            className={`flex-1 flex items-center justify-center gap-2 py-2 min-h-[44px] rounded-lg text-sm transition-colors ${
              box.products.length === 0
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium'
            }`}
          >
            <Lock className="w-4 h-4" />
            Doos afsluiten
          </button>
        )}
      </div>
    </div>
  )
}
