'use client'

import { useState, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import Dialog from './Dialog'

interface PresetNameDialogProps {
  open: boolean
  onClose: () => void
  onSave: (name: string) => void | Promise<void>
  isLoading?: boolean
}

export default function PresetNameDialog({
  open,
  onClose,
  onSave,
  isLoading = false,
}: PresetNameDialogProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setError('')
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Voer een naam in voor de preset')
      return
    }

    setError('')
    await onSave(trimmedName)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSubmit(e)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nieuwe preset maken">
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        <div>
          <label htmlFor="preset-name" className="block text-sm font-medium mb-1">
            Preset naam
          </label>
          <input
            ref={inputRef}
            id="preset-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError('')
            }}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="Voer een naam in..."
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Opslaan
          </button>
        </div>
      </form>
    </Dialog>
  )
}
