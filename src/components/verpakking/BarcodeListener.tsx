'use client'

import { useEffect, useRef, useCallback } from 'react'

interface BarcodeListenerProps {
  onScan: (barcode: string) => void
  enabled: boolean
}

/**
 * Invisible component that detects barcode scanner input via keyboard events.
 * Barcode scanners type characters very fast (< 50ms between chars) and end with Enter.
 * Manual typing is much slower and gets filtered out.
 */
export default function BarcodeListener({ onScan, enabled }: BarcodeListenerProps) {
  const bufferRef = useRef<string>('')
  const lastKeyTimeRef = useRef<number>(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetBuffer = useCallback(() => {
    bufferRef.current = ''
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      const now = Date.now()
      const timeSinceLastKey = now - lastKeyTimeRef.current
      lastKeyTimeRef.current = now

      // If Enter is pressed and we have a buffer
      if (e.key === 'Enter') {
        const barcode = bufferRef.current.trim()
        if (barcode.length >= 4) {
          e.preventDefault()
          onScan(barcode)
        }
        resetBuffer()
        return
      }

      // Only accept printable single characters
      if (e.key.length !== 1) return

      // If too much time passed since last key, start fresh
      if (timeSinceLastKey > 100) {
        bufferRef.current = ''
      }

      bufferRef.current += e.key

      // Auto-clear buffer after 200ms of inactivity (safety net)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(resetBuffer, 200)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      resetBuffer()
    }
  }, [enabled, onScan, resetBuffer])

  return null
}
