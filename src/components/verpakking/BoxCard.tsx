'use client'

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
} from 'lucide-react'

// Lightweight product type for display within a box
export interface BoxProductItem {
  id: string
  productCode: string
  name: string
  weight: number // grams
  imageUrl: string | null
}

// Lightweight box type for display
export interface BoxCardItem {
  id: string
  packagingName: string
  products: BoxProductItem[]
  isClosed: boolean
  shipmentCreated: boolean
}

interface BoxCardProps {
  box: BoxCardItem
  index: number
  onRemoveProduct: (productId: string) => void
  onCloseBox: () => void
  onReopenBox: () => void
  onRemoveBox: () => void
  onCreateShipment: () => void
}

export default function BoxCard({
  box,
  index,
  onRemoveProduct,
  onCloseBox,
  onReopenBox,
  onRemoveBox,
  onCreateShipment,
}: BoxCardProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: box.id,
    disabled: box.isClosed,
  })

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
        {/* Box icon */}
        <div className="w-14 h-14 bg-muted rounded flex items-center justify-center flex-shrink-0">
          <Box className="w-7 h-7 text-muted-foreground" />
        </div>

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
        </div>

        {/* Remove box button (only if empty and not closed) */}
        {box.products.length === 0 && !box.isClosed && (
          <button
            onClick={onRemoveBox}
            className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
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
          <div className={`py-6 text-center border-2 border-dashed rounded-lg ${
            isOver ? 'border-primary bg-primary/10' : 'border-border'
          }`}>
            <Box className={`w-8 h-8 mx-auto mb-2 ${isOver ? 'text-primary' : 'text-muted-foreground'}`} />
            <p className={`text-sm ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
              {isOver ? 'Laat los om toe te voegen' : 'Sleep producten hierheen'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Producten ({box.products.length})
            </p>
            {box.products.map((product) => (
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
                  <p className="text-sm truncate">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.productCode} {product.weight > 0 ? `· ${(product.weight / 1000).toFixed(2)} kg` : ''}
                  </p>
                </div>
                {!box.isClosed && (
                  <button
                    onClick={() => onRemoveProduct(product.id)}
                    className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors"
                    title="Verwijder uit doos"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}

            {/* Drop zone at bottom when products exist */}
            {!box.isClosed && (
              <div className={`py-3 text-center border-2 border-dashed rounded-lg transition-all ${
                isOver ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border'
              }`}>
                <p className={`text-xs ${isOver ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {isOver ? 'Laat los om toe te voegen' : '+ Sleep meer producten'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Box actions */}
      <div className="px-3 pb-3 flex gap-2">
        {box.shipmentCreated ? (
          <div className="flex-1 flex items-center justify-center gap-2 py-2 bg-green-100 text-green-800 rounded-lg text-sm font-medium">
            <Check className="w-4 h-4" />
            Zending aangemaakt
          </div>
        ) : box.isClosed ? (
          <>
            <button
              onClick={onReopenBox}
              className="flex-1 flex items-center justify-center gap-2 py-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
            >
              <Unlock className="w-4 h-4" />
              Heropenen
            </button>
            <button
              onClick={onCreateShipment}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Truck className="w-4 h-4" />
              Maak zending
            </button>
          </>
        ) : (
          <button
            onClick={onCloseBox}
            disabled={box.products.length === 0}
            className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm transition-colors ${
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
