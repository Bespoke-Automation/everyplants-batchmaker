'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Package, GripVertical, Check, X, ChevronDown, Box } from 'lucide-react'
import { useState } from 'react'
import type { Box as BoxType, PicklistProduct } from '@/types/verpakking'

interface ProductCardProps {
  product: PicklistProduct
  boxName: string | null
  boxIndex: number | null
  onRemoveFromBox: () => void
  boxes: BoxType[]
  onAssignToBox: (boxId: string) => void
}

export default function ProductCard({
  product,
  boxName,
  boxIndex,
  onRemoveFromBox,
  boxes,
  onAssignToBox,
}: ProductCardProps) {
  const [showBoxMenu, setShowBoxMenu] = useState(false)
  const isAssigned = product.assignedBoxId !== null

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: product.id,
    disabled: isAssigned, // Can't drag if already assigned
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card border rounded-lg p-3 transition-all ${
        isAssigned
          ? 'border-green-300 bg-green-50/50'
          : 'border-border hover:border-primary/50 hover:shadow-sm'
      } ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle */}
        {!isAssigned && (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none p-1 -ml-1 rounded hover:bg-muted"
          >
            <GripVertical className="w-4 h-4 text-muted-foreground" />
          </div>
        )}

        {/* Checkbox / status indicator */}
        <div
          className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
            isAssigned
              ? 'bg-green-500 border-green-500'
              : 'border-border bg-white'
          }`}
        >
          {isAssigned && <Check className="w-4 h-4 text-white" />}
        </div>

        {/* Product image */}
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-12 h-12 rounded object-cover flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 bg-muted rounded flex items-center justify-center flex-shrink-0">
            <Package className="w-6 h-6 text-muted-foreground" />
          </div>
        )}

        {/* Product info */}
        <div className="flex-1 min-w-0">
          <a
            href="#"
            className="text-primary hover:underline text-sm font-medium"
          >
            {product.productCode}
          </a>
          <p className="text-sm truncate">{product.name}</p>
          <span className="inline-block px-2 py-0.5 text-[10px] bg-muted rounded mt-1">
            {product.location}
          </span>
        </div>

        {/* Amount picker / status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAssigned ? (
            <div className="flex items-center gap-2">
              {/* Box badge */}
              <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded flex items-center gap-1">
                <Box className="w-3 h-3" />
                Doos {boxIndex}
              </span>
              {/* Remove button */}
              <button
                onClick={onRemoveFromBox}
                className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                title="Verwijder uit doos"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              {/* Amount display */}
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <button className="px-2 py-1 text-muted-foreground hover:bg-muted transition-colors">
                  -
                </button>
                <span className="px-3 py-1 text-sm min-w-[3rem] text-center">
                  {product.amountPicked} / {product.amount}
                </span>
                <button className="px-2 py-1 text-muted-foreground hover:bg-muted transition-colors">
                  +
                </button>
              </div>

              {/* Assign to box button (alternative to drag) */}
              <div className="relative">
                <button
                  onClick={() => setShowBoxMenu(!showBoxMenu)}
                  disabled={boxes.length === 0}
                  className={`p-2 rounded-lg transition-colors flex items-center gap-1 text-sm ${
                    boxes.length === 0
                      ? 'text-muted-foreground bg-muted cursor-not-allowed'
                      : 'text-primary hover:bg-primary/10'
                  }`}
                  title={boxes.length === 0 ? 'Voeg eerst een doos toe' : 'Wijs toe aan doos'}
                >
                  <Box className="w-4 h-4" />
                  <ChevronDown className="w-3 h-3" />
                </button>

                {/* Dropdown menu */}
                {showBoxMenu && boxes.length > 0 && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowBoxMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[200px]">
                      <div className="p-1">
                        <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                          Wijs toe aan doos
                        </p>
                        {boxes.map((box, index) => (
                          <button
                            key={box.id}
                            onClick={() => {
                              onAssignToBox(box.id)
                              setShowBoxMenu(false)
                            }}
                            className="w-full flex items-center gap-2 px-2 py-2 text-sm rounded hover:bg-muted transition-colors text-left"
                          >
                            <img
                              src={box.packagingType.imageUrl}
                              alt={box.packagingType.name}
                              className="w-8 h-8 rounded object-cover"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">
                                Doos {index + 1}: {box.packagingType.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {box.products.length} producten
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
