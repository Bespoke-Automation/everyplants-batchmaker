'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import {
  ClipboardList,
  RefreshCw,
  ArrowRightLeft,
  Loader2,
  AlertCircle,
  Lock,
  Play,
  Package,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { usePicklistQueue } from '@/hooks/usePicklistQueue'
import type { Worker, QueuePicklist } from '@/types/verpakking'

interface PicklistQueueProps {
  worker: Worker
  onClearWorker: () => void
  onSessionStarted: (sessionId: string) => void
}

// Country code to flag emoji
function countryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return countryCode
  const code = countryCode.toUpperCase()
  const offset = 127397
  return String.fromCodePoint(...[...code].map((c) => c.charCodeAt(0) + offset))
}

// Tag color based on string hash
const TAG_COLORS = [
  'bg-blue-100 text-blue-800 border-blue-200',
  'bg-green-100 text-green-800 border-green-200',
  'bg-purple-100 text-purple-800 border-purple-200',
  'bg-amber-100 text-amber-800 border-amber-200',
  'bg-rose-100 text-rose-800 border-rose-200',
  'bg-cyan-100 text-cyan-800 border-cyan-200',
  'bg-indigo-100 text-indigo-800 border-indigo-200',
  'bg-teal-100 text-teal-800 border-teal-200',
]

function getTagColor(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]
}

export default function PicklistQueue({
  worker,
  onClearWorker,
  onSessionStarted,
}: PicklistQueueProps) {
  const { picklists, isLoading, error, isClaiming, claimPicklist, refetch } =
    usePicklistQueue(worker.iduser)

  // Confirmation state: only one picklist at a time can be in "confirming" state
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Error feedback state
  const [claimError, setClaimError] = useState<string | null>(null)
  const claimErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss claim error after 5 seconds
  useEffect(() => {
    if (claimError) {
      claimErrorTimerRef.current = setTimeout(() => {
        setClaimError(null)
      }, 5000)
    }
    return () => {
      if (claimErrorTimerRef.current) {
        clearTimeout(claimErrorTimerRef.current)
        claimErrorTimerRef.current = null
      }
    }
  }, [claimError])

  // Auto-cancel confirmation after 5 seconds
  useEffect(() => {
    if (confirmingId !== null) {
      confirmTimerRef.current = setTimeout(() => {
        setConfirmingId(null)
      }, 5000)
    }
    return () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
    }
  }, [confirmingId])

  const handleConfirmClaim = useCallback(
    async (picklist: QueuePicklist) => {
      // Clear the auto-cancel timer but keep confirmingId visible during the claim
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = null
      }
      setClaimError(null)

      const result = await claimPicklist(picklist.idpicklist, worker.fullName)

      // Now dismiss the confirmation UI after the API call completes
      setConfirmingId(null)

      if (result.success && result.sessionId) {
        onSessionStarted(result.sessionId)
      } else if (!result.success) {
        setClaimError(result.error || 'Onbekende fout bij het claimen')
      }
    },
    [claimPicklist, worker.fullName, onSessionStarted]
  )

  const handleCancelConfirm = useCallback(() => {
    setConfirmingId(null)
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = null
    }
  }, [])

  const handleClaim = useCallback(
    async (picklist: QueuePicklist) => {
      setClaimError(null)
      const result = await claimPicklist(picklist.idpicklist, worker.fullName)
      if (result.success && result.sessionId) {
        onSessionStarted(result.sessionId)
      } else if (!result.success) {
        setClaimError(result.error || 'Onbekende fout bij het claimen')
      }
    },
    [claimPicklist, worker.fullName, onSessionStarted]
  )

  return (
    <div className="flex-1 flex flex-col">
      {/* Worker header bar */}
      <div className="bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
            {(worker.firstname?.[0] ?? '').toUpperCase()}
            {(worker.lastname?.[0] ?? '').toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-base">{worker.fullName}</p>
            <p className="text-sm text-muted-foreground">Inpakker</p>
          </div>
        </div>
        <button
          onClick={onClearWorker}
          className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[44px]"
        >
          <ArrowRightLeft className="w-4 h-4" />
          Wissel
        </button>
      </div>

      {/* Queue header */}
      <div className="bg-muted/30 border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-muted-foreground" />
          <h2 className="font-semibold text-lg">
            Wachtrij
            {!isLoading && (
              <span className="text-muted-foreground font-normal ml-1">
                ({picklists.length} picklist{picklists.length !== 1 ? 's' : ''})
              </span>
            )}
          </h2>
        </div>
        <button
          onClick={refetch}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[44px] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Vernieuw
        </button>
      </div>

      {/* Claim error banner */}
      {claimError && (
        <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="flex-1 font-medium">{claimError}</span>
          <button
            onClick={() => setClaimError(null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium hover:bg-destructive/20 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Sluiten"
          >
            &times;
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {/* Error state */}
        {error && (
          <div className="p-6 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="w-7 h-7 text-destructive" />
            </div>
            <div>
              <h3 className="font-bold text-lg mb-1">Fout bij laden</h3>
              <p className="text-muted-foreground">{error.message}</p>
            </div>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors min-h-[48px]"
            >
              <RefreshCw className="w-5 h-5" />
              Opnieuw proberen
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && picklists.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-muted-foreground text-base">Picklists laden...</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && picklists.length === 0 && (
          <div className="p-8 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <ClipboardList className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-bold text-lg mb-1">Wachtrij is leeg</h3>
              <p className="text-muted-foreground">
                Er zijn momenteel geen openstaande picklists.
              </p>
            </div>
            <button
              onClick={refetch}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors min-h-[48px]"
            >
              <RefreshCw className="w-5 h-5" />
              Vernieuw
            </button>
          </div>
        )}

        {/* Picklist cards */}
        {!error && picklists.length > 0 && (
          <div className="p-4 space-y-3">
            {picklists.map((pl) => {
              const isClaimedByMe =
                pl.isClaimed && pl.claimedByName === worker.fullName
              const isClaimedByOther =
                pl.isClaimed && pl.claimedByName !== worker.fullName

              const isConfirming = confirmingId === pl.idpicklist

              return (
                <div
                  key={pl.idpicklist}
                  className={`bg-card border rounded-xl p-4 transition-colors ${
                    isClaimedByOther
                      ? 'border-border opacity-60'
                      : isClaimedByMe
                        ? 'border-primary bg-primary/5'
                        : isConfirming
                          ? 'border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-200'
                          : 'border-border hover:border-primary/50'
                  } ${pl.urgent && !isConfirming ? 'ring-2 ring-amber-400' : ''}`}
                >
                  {/* Top row: picklist ID + delivery name */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-base">{pl.picklistid}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-base truncate">{pl.deliveryname}</span>
                        {pl.urgent && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded text-xs font-medium">
                            <AlertTriangle className="w-3 h-3" />
                            Urgent
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Details row */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
                    <span className="inline-flex items-center gap-1">
                      {countryFlag(pl.deliverycountry)}{' '}
                      {pl.deliverycountry}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Package className="w-4 h-4" />
                      {pl.totalproducts} product{pl.totalproducts !== 1 ? 'en' : ''}
                    </span>
                    {pl.preferred_delivery_date && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        {new Date(pl.preferred_delivery_date).toLocaleDateString('nl-NL', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    )}
                  </div>

                  {/* Tags + action row */}
                  <div className="flex items-center justify-between gap-3">
                    {/* Tags */}
                    <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
                      {pl.tags.map((tag) => (
                        <span
                          key={tag}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md border ${getTagColor(tag)}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    {/* Action button */}
                    <div className="shrink-0">
                      {isClaimedByOther && (
                        <span className="inline-flex items-center gap-2 px-4 py-2.5 bg-muted rounded-lg text-sm text-muted-foreground min-h-[44px]">
                          <Lock className="w-4 h-4" />
                          {pl.claimedByName}
                        </span>
                      )}
                      {isClaimedByMe && (
                        <button
                          onClick={() => {
                            // For "continue" we'd need the session ID.
                            // For now, re-claim which returns the existing session.
                            handleClaim(pl)
                          }}
                          disabled={isClaiming}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50"
                        >
                          {isClaiming ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Doorgaan
                        </button>
                      )}
                      {!pl.isClaimed && confirmingId === pl.idpicklist && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => handleConfirmClaim(pl)}
                            disabled={isClaiming}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors min-h-[44px] disabled:opacity-50"
                          >
                            {isClaiming ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                            Bevestig
                          </button>
                          <button
                            onClick={handleCancelConfirm}
                            disabled={isClaiming}
                            className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-muted-foreground rounded-lg font-medium text-sm hover:bg-muted transition-colors min-h-[44px] disabled:opacity-50"
                          >
                            Annuleer
                          </button>
                        </div>
                      )}
                      {!pl.isClaimed && confirmingId !== pl.idpicklist && (
                        <button
                          onClick={() => setConfirmingId(pl.idpicklist)}
                          disabled={isClaiming}
                          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors min-h-[44px] disabled:opacity-50"
                        >
                          {isClaiming ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Play className="w-4 h-4" />
                          )}
                          Claimen
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer with auto-refresh indicator */}
      <div className="border-t border-border bg-muted/30 px-4 py-2.5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5" />
        Auto-refresh: 5s
      </div>
    </div>
  )
}
