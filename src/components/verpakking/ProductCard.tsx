'use client'

import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Package, GripVertical, Check, X, ChevronDown, Box, Minus, Plus } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'

// Box assignment for split tracking
export interface BoxAssignment {
  boxId: string
  boxName: string
  boxIndex: number
  amount: number
  sessionProductId: string
}

// Lightweight product type for display
export interface ProductCardItem {
  id: string // unique key (productcode or idproduct-based)
  productCode: string
  name: string
  amount: number
  amountPicked: number
  weight: number // in grams (0 if unknown)
  imageUrl: string | null
  location: string
  assignedBoxId: string | null
  amountAssigned: number
  assignedBoxes: BoxAssignment[]
}

// Lightweight box reference for the dropdown
export interface BoxRef {
  id: string
  name: string
  index: number
  productCount: number
  isClosed: boolean
}

interface ProductCardProps {
  product: ProductCardItem
  onRemoveFromBox: (sessionProductId?: string) => void
  boxes: BoxRef[]
  onAssignToBox: (boxId: string, amount: number) => void
  isSelected?: boolean
  onSelectToggle?: () => void
  isHighlighted?: boolean
}

export default function ProductCard({
  product,
  onRemoveFromBox,
  boxes,
  onAssignToBox,
  isSelected,
  onSelectToggle,
  isHighlighted,
}: ProductCardProps) {
  const [showBoxMenu, setShowBoxMenu] = useState(false)
  const [pendingBoxId, setPendingBoxId] = useState<string | null>(null)
  const remaining = product.amount - product.amountAssigned
  const [splitAmount, setSplitAmount] = useState(remaining)
  const inputRef = useRef<HTMLInputElement>(null)

  const isFullyAssigned = product.amountAssigned >= product.amount
  const isPartiallyAssigned = product.amountAssigned > 0 && !isFullyAssigned

  // Reset splitAmount when remaining changes
  useEffect(() => {
    setSplitAmount(remaining)
  }, [remaining])

  // Focus input when split picker appears
  useEffect(() => {
    if (pendingBoxId && inputRef.current) {
      inputRef.current.select()
    }
  }, [pendingBoxId])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: product.id,
    disabled: isFullyAssigned,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  const openBoxes = boxes.filter((b) => !b.isClosed)

  const handleBoxClick = (boxId: string) => {
    if (remaining <= 1) {
      // Direct assign (1 item left or single-item product)
      onAssignToBox(boxId, remaining)
      setShowBoxMenu(false)
      setPendingBoxId(null)
    } else {
      // Show amount picker
      setPendingBoxId(boxId)
      setSplitAmount(remaining)
    }
  }

  const handleConfirmSplit = () => {
    if (!pendingBoxId || splitAmount <= 0) return
    onAssignToBox(pendingBoxId, splitAmount)
    setShowBoxMenu(false)
    setPendingBoxId(null)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-card border rounded-lg p-3 transition-all ${
        isHighlighted
          ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-300 animate-pulse'
          : isFullyAssigned
            ? 'border-green-300 bg-green-50/50'
            : isPartiallyAssigned
              ? 'border-amber-300 bg-amber-50/30'
              : isSelected
                ? 'border-blue-400 bg-blue-50/50 ring-1 ring-blue-300'
                : 'border-border hover:border-primary/50 hover:shadow-sm'
      } ${isDragging ? 'shadow-lg ring-2 ring-primary' : ''}`}
    >
      <div className="flex items-center gap-3">
        {/* Drag handle - larger touch target for tablet use */}
        {!isFullyAssigned && (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing touch-none p-2 -ml-2 rounded-lg hover:bg-muted min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <GripVertical className="w-5 h-5 text-muted-foreground" />
          </div>
        )}

        {/* Checkbox / status indicator */}
        {isFullyAssigned ? (
          <div className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 bg-green-500 border-green-500">
            <Check className="w-4 h-4 text-white" />
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onSelectToggle?.()
            }}
            className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
              isSelected
                ? 'bg-blue-500 border-blue-500'
                : 'border-border bg-white hover:border-blue-300'
            }`}
          >
            {isSelected && <Check className="w-4 h-4 text-white" />}
          </button>
        )}

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
          <span className="text-primary text-sm font-medium">
            {product.productCode}
          </span>
          <p className="text-sm truncate">{product.name}</p>
          {product.location && (
            <span className="inline-block px-2 py-0.5 text-[10px] bg-muted rounded mt-1">
              {product.location}
            </span>
          )}
          {/* Assignment badges for partially/fully assigned across multiple boxes */}
          {product.assignedBoxes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {product.assignedBoxes.map((ab) => (
                <span
                  key={ab.sessionProductId}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded"
                >
                  <Box className="w-2.5 h-2.5" />
                  Doos {ab.boxIndex}: {ab.amount}x
                  {!isFullyAssigned && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveFromBox(ab.sessionProductId)
                      }}
                      className="ml-0.5 hover:text-red-600 transition-colors"
                      title="Verwijder uit doos"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              ))}
              {remaining > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded">
                  {remaining}x resterend
                </span>
              )}
            </div>
          )}
        </div>

        {/* Amount picker / status */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFullyAssigned ? (
            <div className="flex items-center gap-2">
              {/* Box badges for fully assigned */}
              {product.assignedBoxes.length === 1 ? (
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded flex items-center gap-1">
                  <Box className="w-3 h-3" />
                  Doos {product.assignedBoxes[0].boxIndex}
                  {product.amount > 1 && <span>({product.amount}x)</span>}
                </span>
              ) : (
                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {product.amount}x verdeeld
                </span>
              )}
              {/* Remove button per assignment */}
              {product.assignedBoxes.length === 1 && (
                <button
                  onClick={() => onRemoveFromBox(product.assignedBoxes[0].sessionProductId)}
                  className="p-2 rounded-lg hover:bg-red-100 text-red-500 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                  title="Verwijder uit doos"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Amount display */}
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <span className="px-3 py-1 text-sm min-w-[3rem] text-center">
                  {product.amountAssigned} / {product.amount}
                </span>
              </div>

              {/* Assign to box button (alternative to drag) */}
              <div className="relative">
                <button
                  onClick={() => {
                    setShowBoxMenu(!showBoxMenu)
                    setPendingBoxId(null)
                  }}
                  disabled={openBoxes.length === 0}
                  className={`p-2 rounded-lg transition-colors flex items-center gap-1 text-sm min-w-[44px] min-h-[44px] justify-center ${
                    openBoxes.length === 0
                      ? 'text-muted-foreground bg-muted cursor-not-allowed'
                      : 'text-primary hover:bg-primary/10'
                  }`}
                  title={openBoxes.length === 0 ? 'Voeg eerst een doos toe' : 'Wijs toe aan doos'}
                >
                  <Box className="w-4 h-4" />
                  <ChevronDown className="w-3 h-3" />
                </button>

                {/* Dropdown menu */}
                {showBoxMenu && openBoxes.length > 0 && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => {
                        setShowBoxMenu(false)
                        setPendingBoxId(null)
                      }}
                    />
                    <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-20 min-w-[220px]">
                      <div className="p-1">
                        <p className="px-2 py-1 text-xs text-muted-foreground font-medium">
                          Wijs toe aan doos {remaining > 1 ? `(${remaining}x beschikbaar)` : ''}
                        </p>
                        {openBoxes.map((box) => (
                          <div key={box.id}>
                            <button
                              onClick={() => handleBoxClick(box.id)}
                              className={`w-full flex items-center gap-2 px-2 py-2.5 text-sm rounded-lg hover:bg-muted transition-colors text-left min-h-[44px] ${
                                pendingBoxId === box.id ? 'bg-muted' : ''
                              }`}
                            >
                              <div className="w-8 h-8 bg-muted rounded flex items-center justify-center flex-shrink-0">
                                <Box className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">
                                  Doos {box.index}: {box.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {box.productCount} producten
                                </p>
                              </div>
                            </button>
                            {/* Inline amount picker */}
                            {pendingBoxId === box.id && (
                              <div className="px-2 pb-2 pt-1">
                                <div className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">Aantal:</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSplitAmount((a) => Math.max(1, a - 1))
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded bg-card border border-border hover:bg-muted transition-colors"
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <input
                                    ref={inputRef}
                                    type="number"
                                    min={1}
                                    max={remaining}
                                    value={splitAmount}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10)
                                      if (!isNaN(v)) setSplitAmount(Math.max(1, Math.min(remaining, v)))
                                    }}
                                    className="w-12 h-8 text-center text-sm border border-border rounded bg-card focus:outline-none focus:ring-1 focus:ring-primary"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSplitAmount((a) => Math.min(remaining, a + 1))
                                    }}
                                    className="w-8 h-8 flex items-center justify-center rounded bg-card border border-border hover:bg-muted transition-colors"
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleConfirmSplit()
                                    }}
                                    className="px-3 h-8 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary/90 transition-colors whitespace-nowrap"
                                  >
                                    Bevestig
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
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
