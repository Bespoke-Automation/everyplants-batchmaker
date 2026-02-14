'use client'

import { useState, useMemo } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Search,
  Tag,
} from 'lucide-react'
import { useLocalTags } from '@/hooks/useLocalTags'

export default function TagList() {
  const {
    tags,
    isLoading,
    error,
    isSyncing,
    syncFromPicqer,
  } = useLocalTags()

  const [searchQuery, setSearchQuery] = useState('')
  const [syncResult, setSyncResult] = useState<string | null>(null)

  const filteredTags = useMemo(() => {
    if (!searchQuery.trim()) return tags
    const q = searchQuery.toLowerCase()
    return tags.filter((t) => t.title.toLowerCase().includes(q))
  }, [tags, searchQuery])

  const lastSyncedAt = useMemo(() => {
    if (tags.length === 0) return null
    const dates = tags.map((t) => new Date(t.lastSyncedAt).getTime())
    const latest = Math.max(...dates)
    const mins = Math.round((Date.now() - latest) / 60000)
    if (mins < 1) return 'Zojuist'
    if (mins < 60) return `${mins} min geleden`
    const hours = Math.round(mins / 60)
    return `${hours} uur geleden`
  }, [tags])

  const handleSync = async () => {
    setSyncResult(null)
    try {
      const result = await syncFromPicqer()
      setSyncResult(`${result.synced} tags gesynchroniseerd (${result.added} nieuw, ${result.updated} bijgewerkt)`)
    } catch {
      // Error is set by the hook
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Tags laden...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Tag className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Tags</h2>
            {lastSyncedAt && (
              <p className="text-xs text-muted-foreground">
                Laatst gesynchroniseerd: {lastSyncedAt}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {isSyncing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4" />
          )}
          Synchroniseer van Picqer
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-800">
          <RefreshCw className="w-4 h-4 shrink-0" />
          {syncResult}
        </div>
      )}

      {/* Empty state */}
      {tags.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Tag className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Nog geen tags gesynchroniseerd</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Klik op &quot;Synchroniseer van Picqer&quot; om tags op te halen.
          </p>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors mx-auto disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5" />
            )}
            Synchroniseer
          </button>
        </div>
      ) : (
        <>
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Zoek op titel..."
              className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
            />
          </div>

          {/* Tag count */}
          <p className="text-xs text-muted-foreground mb-2">
            {filteredTags.length} {filteredTags.length === 1 ? 'tag' : 'tags'}
            {searchQuery.trim() && ` gevonden`}
          </p>

          {/* Tag list */}
          <div className="space-y-1">
            {filteredTags.map((tag) => (
              <div
                key={tag.id}
                className="flex items-center gap-3 p-3 bg-card border border-border rounded-lg"
              >
                <div
                  className="w-4 h-4 rounded-full shrink-0 border border-black/10"
                  style={{ backgroundColor: tag.color || '#ccc' }}
                />
                <span className="flex-1 text-sm font-medium truncate">
                  {tag.title}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
