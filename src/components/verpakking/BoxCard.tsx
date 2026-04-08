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
  ZoomIn,
} from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'

// Lightweight product type for display within a box
export interface BoxProduct {
  id: string
  productCode: string
  name: string
  amount: number
  maxAmount: number
  weight: number // in grams
  imageUrl: string | null
}

export interface BoxCardItem {
  id: string
  packagingName: string
  picqerPackagingId: number | null
  packagingImageUrl?: string | null
  products: BoxProduct[]
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
  onCancelShipment?: () => Promise<void>
  onAssignAllProducts?: () => void
  unassignedProductCount?: number
  readOnly?: boolean
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
  readOnly = false,
}: BoxCardProps) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: box.id,
    disabled: box.isClosed,
  })

  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [cancelTimeLeft, setCancelTimeLeft] = useState<number | null>(null)
  const [lightboxImage, setLightboxImage] = useState<{ url: string; alt: string } | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const stepperRef = useRef<HTMLDivElement>(null)

  // Cancel countdown timer
  useEffect(() => {
    if (!box.shippedAt) { setCancelTimeLeft(null); return }
    const shippedTime = new Date(box.shippedAt).getTime()
    const fiveMinutes = 5 * 60 * 1000
    const update = () => {
      const remaining = fiveMinutes - (Date.now() - shippedTime)
      setCancelTimeLeft(remaining > 0 ? remaining : 0)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [box.shippedAt])

  // Click outside to close stepper
  useEffect(() => {
    if (!editingProductId) return
    const handler = (e: MouseEvent) => {
      if (stepperRef.current && !stepperRef.current.contains(e.target as Node)) {
        setEditingProductId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingProductId])

  const totalWeight = box.products.reduce((sum, p) => sum + p.weight, 0)

  // === SHIPPED STATE: Compact 1-line with tracking ===
  if (box.shipmentCreated) {
    return (
      <div className="border border-green-300 bg-green-50/50 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500 text-white">
            <Check className="w-3.5 h-3.5" />
            {t.packing.shipped}
          </span>
          <span className="text-sm font-bold truncate">{box.packagingName}</span>
          <span className="text-xs text-muted-foreground">{box.products.length} prod · {(totalWeight / 1000).toFixed(1)}kg</span>
          {box.trackingCode && (
            box.trackingUrl ? (
              <a href={box.trackingUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-primary hover:underline ml-auto">
                {box.trackingCode}
              </a>
            ) : (
              <span className="font-mono text-xs text-muted-foreground ml-auto">{box.trackingCode}</span>
            )
          )}
          {box.labelUrl ? (
            <a href={box.labelUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 border border-border rounded text-xs hover:bg-muted transition-colors" title="Label openen">
              <FileText className="w-3 h-3" />
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3 animate-spin" />
              Label...
            </span>
          )}
          {onCancelShipment && (
            <button
              onClick={async () => { setIsCancelling(true); try { await onCancelShipment() } finally { setIsCancelling(false) } }}
              disabled={isCancelling}
              className="inline-flex items-center gap-1 px-2 py-1 border border-red-200 text-red-600 rounded text-xs hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {isCancelling ? <Clock className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
              {t.packing.cancelShipment}
            </button>
          )}
        </div>

        {/* Lightbox */}
        {lightboxImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setLightboxImage(null)}>
            <button type="button" onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X className="w-6 h-6" /></button>
            <img src={lightboxImage.url} alt={lightboxImage.alt} className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    )
  }

  // === CLOSED STATE: Compact header with actions, products hidden ===
  if (box.isClosed) {
    return (
      <div ref={setNodeRef} className="border border-blue-300 bg-blue-50/30 rounded-lg overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2.5">
          {box.packagingImageUrl ? (
            <button type="button" onClick={() => setLightboxImage({ url: box.packagingImageUrl!, alt: box.packagingName })} className="relative group flex-shrink-0">
              <img src={box.packagingImageUrl} alt={box.packagingName} className="w-12 h-12 rounded-lg object-cover" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ) : (
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
              <Box className="w-5 h-5 text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold truncate">{box.packagingName}</h3>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500 text-white flex-shrink-0">
                <Lock className="w-3.5 h-3.5" />
                {t.packing.closed}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{box.products.length} {t.common.products} · {(totalWeight / 1000).toFixed(2)} kg</p>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={onReopenBox} className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] border border-border rounded-lg text-sm hover:bg-muted transition-colors">
                <Unlock className="w-4 h-4" />
                {t.packing.reopenBox}
              </button>
              <button onClick={onCreateShipment} className="inline-flex items-center gap-1.5 px-4 py-1.5 min-h-[44px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors border border-primary">
                <Truck className="w-4 h-4" />
                {t.packing.createShipment}
              </button>
            </div>
          )}
        </div>

        {/* Lightbox */}
        {lightboxImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setLightboxImage(null)}>
            <button type="button" onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X className="w-6 h-6" /></button>
            <img src={lightboxImage.url} alt={lightboxImage.alt} className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    )
  }

  // === OPEN STATE: Full card with products, drop zone, actions ===
  return (
    <div
      ref={setNodeRef}
      className={`border rounded-lg overflow-hidden transition-all ${
        isOver
          ? 'border-primary border-2 bg-primary/5 shadow-lg'
          : 'border-border bg-card hover:border-primary/30'
      }`}
    >
      {/* Box header */}
      <div className="flex items-center gap-3 p-3 border-b border-border bg-muted/30">
        {box.packagingImageUrl ? (
          <button type="button" onClick={() => setLightboxImage({ url: box.packagingImageUrl!, alt: box.packagingName })} className="relative group flex-shrink-0">
            <img src={box.packagingImageUrl} alt={box.packagingName} className="w-[104px] h-[104px] rounded-lg object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
              <ZoomIn className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ) : (
          <div className="w-[104px] h-[104px] bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
            <Box className="w-8 h-8 text-muted-foreground" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold">{box.packagingName}</h3>
          {!box.picqerPackagingId && (
            <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
              <AlertTriangle className="w-3 h-3" />
              {t.packing.noPicqerId}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onCloseBox}
            disabled={box.products.length === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors border ${
              box.products.length === 0
                ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                : 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
            }`}
          >
            <Lock className="w-4 h-4" />
            {t.packing.closeBox}
          </button>
          {box.products.length === 0 && (
            <button onClick={onRemoveBox} className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-border" title={t.packing.removeBox}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Weight indicator */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Weight className="w-3 h-3" />
            {t.packing.weight}
          </span>
          <span>{(totalWeight / 1000).toFixed(2)} kg</span>
        </div>
      </div>

      {/* Products in box */}
      <div className="p-3">
        {box.products.length === 0 ? (
          <div className="space-y-2">
            {unassignedProductCount > 0 && onAssignAllProducts && (
              <button onClick={onAssignAllProducts} className="w-full flex items-center justify-center gap-2 py-3 min-h-[48px] bg-primary/10 text-primary border border-primary/30 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors">
                <Package className="w-4 h-4" />
                {t.packing.assignAll} ({unassignedProductCount})
              </button>
            )}
            <div className={`py-6 text-center border-2 border-dashed rounded-lg ${isOver ? 'border-primary bg-primary/10' : 'border-border'}`}>
              <Box className={`w-8 h-8 mx-auto mb-2 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className={`text-sm ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {isOver ? t.packing.dropToAdd : t.packing.dragProducts}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t.packing.productsTab} ({box.products.length})
            </p>
            {box.products.map((product) => {
              const isEditing = editingProductId === product.id
              return (
                <div key={product.id} className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg">
                  {product.imageUrl ? (
                    <button type="button" onClick={() => setLightboxImage({ url: product.imageUrl!, alt: product.name })} className="relative group flex-shrink-0">
                      <img src={product.imageUrl} alt={product.name} className="w-12 h-12 rounded-lg object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 rounded-lg transition-colors flex items-center justify-center">
                        <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ) : (
                    <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
                      <Package className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div ref={stepperRef} className="flex items-center gap-1">
                        <button
                          onClick={() => { const n = product.amount - 1; if (n <= 0) { onRemoveProduct(product.id); setEditingProductId(null) } else { onUpdateProductAmount(product.id, n) } }}
                          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${product.amount <= 1 ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-muted hover:bg-muted/80'}`}
                          title={product.amount <= 1 ? 'Verwijder uit doos' : 'Eén minder'}
                        >
                          {product.amount <= 1 ? <Trash2 className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                        </button>
                        <span className="min-w-[36px] text-center font-semibold text-base tabular-nums">{product.amount}</span>
                        <button
                          onClick={() => { if (product.amount < product.maxAmount) onUpdateProductAmount(product.id, product.amount + 1) }}
                          disabled={product.amount >= product.maxAmount}
                          className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg transition-colors ${product.amount >= product.maxAmount ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <p className="text-sm truncate ml-1">{product.name}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={() => setEditingProductId(product.id)}
                          className="inline-flex items-center justify-center min-w-[40px] min-h-[32px] px-2 py-1 rounded-md border border-primary/30 bg-primary/5 text-primary font-semibold text-sm hover:bg-primary/10 hover:border-primary/50 transition-colors flex-shrink-0"
                          title={t.packing.assignToBox}
                        >
                          {product.amount}x
                        </button>
                        <div className="min-w-0">
                          <p className="text-sm truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.productCode} {product.weight > 0 ? `· ${(product.weight / 1000).toFixed(2)} kg` : ''}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {!isEditing && (
                    <button onClick={() => onRemoveProduct(product.id)} disabled={box.isClosed} className={`p-2 rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center border border-border ${box.isClosed ? 'text-muted-foreground/30 cursor-not-allowed' : 'text-muted-foreground hover:text-red-500 hover:bg-red-50'}`} title={box.isClosed ? 'Heropen doos eerst' : 'Verwijder uit doos'}>
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            })}

            {/* Assign remaining + drop zone */}
            <div className="space-y-2">
              {unassignedProductCount > 0 && onAssignAllProducts && (
                <button onClick={onAssignAllProducts} className="w-full flex items-center justify-center gap-2 py-2.5 min-h-[44px] bg-primary/10 text-primary border border-primary/30 rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors">
                  <Package className="w-4 h-4" />
                  {t.packing.assignRemaining} ({unassignedProductCount})
                </button>
              )}
              <div className={`py-3 text-center border-2 border-dashed rounded-lg transition-all ${isOver ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border'}`}>
                <p className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {isOver ? t.packing.dropToAdd : t.packing.dragMore}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Image lightbox modal */}
      {lightboxImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setLightboxImage(null)}>
          <button type="button" onClick={() => setLightboxImage(null)} className="absolute top-4 right-4 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"><X className="w-6 h-6" /></button>
          <img src={lightboxImage.url} alt={lightboxImage.alt} className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
