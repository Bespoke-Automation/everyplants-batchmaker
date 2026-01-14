'use client'

import { Search, X, Loader2 } from 'lucide-react'

interface TableSearchProps {
  value: string
  onChange: (value: string) => void
  onClear: () => void
  placeholder?: string
  isSearching?: boolean
}

export default function TableSearch({
  value,
  onChange,
  onClear,
  placeholder = 'Zoeken...',
  isSearching = false,
}: TableSearchProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-8 h-9 w-48 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {value && (
        <button
          onClick={onClear}
          className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
        >
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  )
}
