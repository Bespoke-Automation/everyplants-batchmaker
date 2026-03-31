'use client'

import { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export default function Dialog({ open, onClose, title, children, className = '' }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  // Focus + scroll lock: only on open/close
  useEffect(() => {
    if (open) {
      previousActiveElement.current = document.activeElement as HTMLElement
      document.body.style.overflow = 'hidden'

      // Focus the dialog on initial open
      setTimeout(() => {
        dialogRef.current?.focus()
      }, 0)
    } else {
      document.body.style.overflow = ''
      previousActiveElement.current?.focus()
    }

    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Escape handler: separate effect so it doesn't steal focus
  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, handleEscape])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'dialog-title' : undefined}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 animate-in fade-in duration-200" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative bg-card border border-border rounded-lg shadow-xl w-full mx-4 animate-in zoom-in-95 fade-in duration-200 ${className || 'max-w-md'}`}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-4 sm:p-5 border-b border-border">
            <h2 id="dialog-title" className="font-semibold text-lg sm:text-xl">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className={`${title ? '' : 'pt-4'} ${className?.includes('flex-col') ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : ''}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
