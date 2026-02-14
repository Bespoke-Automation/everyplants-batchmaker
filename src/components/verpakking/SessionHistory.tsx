'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Layers,
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ClipboardList,
} from 'lucide-react'

interface BatchSession {
  id: string
  batch_id: number
  batch_display_id: string | null
  total_picklists: number
  completed_picklists: number
  assigned_to_name: string
  status: string
  created_at: string
  completed_at: string | null
}

interface PackingSession {
  id: string
  picklist_id: number
  picklistid: string
  assigned_to_name: string
  status: string
  created_at: string
  completed_at: string | null
  batch_session_id: string | null
}

interface BatchSessionsResponse {
  sessions: BatchSession[]
  total: number
}

interface PackingSessionsResponse {
  sessions: PackingSession[]
  total: number
}

const PAGE_SIZE = 20

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  claimed: {
    label: 'Geclaimd',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  in_progress: {
    label: 'Bezig',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  assigned: {
    label: 'Toegewezen',
    className: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  packing: {
    label: 'Inpakken',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  shipping: {
    label: 'Verzenden',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  completed: {
    label: 'Voltooid',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  failed: {
    label: 'Mislukt',
    className: 'bg-red-100 text-red-800 border-red-200',
  },
}

function getStatusBadge(status: string) {
  const config = STATUS_CONFIG[status] ?? {
    label: status,
    className: 'bg-muted text-muted-foreground border-border',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}
    >
      {config.label}
    </span>
  )
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '-'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  const remainMins = mins % 60
  return `${hrs}u ${remainMins}m`
}

export default function SessionHistory() {
  const [batchSessions, setBatchSessions] = useState<BatchSession[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [batchPicklistSessions, setBatchPicklistSessions] = useState<PackingSession[]>([])
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchSessions = useCallback(async (pageNum: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const offset = pageNum * PAGE_SIZE
      const response = await fetch(
        `/api/verpakking/batch-sessions?limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Kon sessies niet laden')
      }
      const data: BatchSessionsResponse = await response.json()
      setBatchSessions(data.sessions ?? [])
      setTotal(data.total ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions(page)
  }, [page, fetchSessions])

  const handleRefresh = () => {
    fetchSessions(page)
  }

  const goToPrevPage = () => {
    setPage((p) => Math.max(0, p - 1))
  }

  const goToNextPage = () => {
    setPage((p) => Math.min(totalPages - 1, p + 1))
  }

  const toggleBatchDetails = async (batchSessionId: string) => {
    if (expandedBatch === batchSessionId) {
      setExpandedBatch(null)
      setBatchPicklistSessions([])
      return
    }

    setExpandedBatch(batchSessionId)
    setIsLoadingDetails(true)

    try {
      const response = await fetch(`/api/verpakking/batch-sessions/${batchSessionId}`)
      if (response.ok) {
        const data = await response.json()
        setBatchPicklistSessions(data.packing_sessions ?? [])
      }
    } catch {
      // Silently fail for details
    } finally {
      setIsLoadingDetails(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Batch Geschiedenis</h2>
            <p className="text-sm text-muted-foreground">
              Overzicht van alle batch sessies
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
          title="Vernieuwen"
        >
          <RefreshCw
            className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
          />
          <span className="text-sm hidden sm:inline">Vernieuwen</span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoading && batchSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">Sessies laden...</p>
        </div>
      ) : batchSessions.length === 0 && !error ? (
        /* Empty state */
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Geen sessies</h3>
          <p className="text-sm text-muted-foreground">
            Er zijn nog geen batch sessies gevonden.
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_100px_100px_120px] gap-4 px-4 py-3 bg-muted/50 border-b border-border text-sm font-medium text-muted-foreground">
              <div>Datum</div>
              <div>Batch</div>
              <div>Medewerker</div>
              <div>Picklists</div>
              <div>Duur</div>
              <div>Status</div>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border">
              {batchSessions.map((session) => (
                <div key={session.id}>
                  <button
                    onClick={() => toggleBatchDetails(session.id)}
                    className="w-full px-4 py-3 sm:grid sm:grid-cols-[1fr_1fr_1fr_100px_100px_120px] sm:gap-4 sm:items-center flex flex-col gap-2 hover:bg-muted/30 transition-colors text-left"
                  >
                    {/* Date */}
                    <div>
                      <span className="sm:hidden text-xs text-muted-foreground font-medium">
                        Datum:{' '}
                      </span>
                      <span className="text-sm">
                        {formatDate(session.created_at)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1.5">
                        {formatTime(session.created_at)}
                      </span>
                    </div>

                    {/* Batch ID */}
                    <div className="flex items-center gap-1.5">
                      <span className="sm:hidden text-xs text-muted-foreground font-medium">
                        Batch:{' '}
                      </span>
                      <span className="text-sm font-mono">
                        {session.batch_display_id || session.batch_id}
                      </span>
                      {expandedBatch === session.id ? (
                        <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </div>

                    {/* Worker */}
                    <div>
                      <span className="sm:hidden text-xs text-muted-foreground font-medium">
                        Medewerker:{' '}
                      </span>
                      <span className="text-sm">
                        {session.assigned_to_name || '-'}
                      </span>
                    </div>

                    {/* Picklists count */}
                    <div>
                      <span className="sm:hidden text-xs text-muted-foreground font-medium">
                        Picklists:{' '}
                      </span>
                      <span className="text-sm">
                        {session.completed_picklists}/{session.total_picklists}
                      </span>
                    </div>

                    {/* Duration */}
                    <div>
                      <span className="sm:hidden text-xs text-muted-foreground font-medium">
                        Duur:{' '}
                      </span>
                      <span className="text-sm">
                        {formatDuration(session.created_at, session.completed_at)}
                      </span>
                    </div>

                    {/* Status */}
                    <div>
                      <span className="sm:hidden text-xs text-muted-foreground font-medium mr-1">
                        Status:{' '}
                      </span>
                      {getStatusBadge(session.status)}
                    </div>
                  </button>

                  {/* Expanded picklist details */}
                  {expandedBatch === session.id && (
                    <div className="px-4 pb-3 bg-muted/20">
                      {isLoadingDetails ? (
                        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Picklists laden...
                        </div>
                      ) : batchPicklistSessions.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-3">
                          Geen picklist sessies gevonden.
                        </p>
                      ) : (
                        <div className="border border-border rounded-lg overflow-hidden bg-card">
                          <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_120px] gap-3 px-3 py-2 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground">
                            <div>Picklist</div>
                            <div>Tijdstip</div>
                            <div>Status</div>
                          </div>
                          <div className="divide-y divide-border">
                            {batchPicklistSessions.map((ps) => (
                              <div
                                key={ps.id}
                                className="px-3 py-2 sm:grid sm:grid-cols-[1fr_1fr_120px] sm:gap-3 sm:items-center flex flex-col gap-1 text-sm"
                              >
                                <div className="flex items-center gap-1.5">
                                  <ClipboardList className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="font-mono text-xs">
                                    {ps.picklistid || ps.picklist_id}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {formatTime(ps.created_at)}
                                  {ps.completed_at && (
                                    <span className="ml-1.5">
                                      ({formatDuration(ps.created_at, ps.completed_at)})
                                    </span>
                                  )}
                                </div>
                                <div>{getStatusBadge(ps.status)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={goToPrevPage}
                disabled={page === 0 || isLoading}
                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Vorige
              </button>

              <span className="text-sm text-muted-foreground">
                Pagina {page + 1} van {totalPages}
              </span>

              <button
                onClick={goToNextPage}
                disabled={page >= totalPages - 1 || isLoading}
                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Volgende
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Total count */}
          <p className="text-xs text-muted-foreground text-center mt-3">
            {total} batch sessie{total !== 1 ? 's' : ''} totaal
          </p>
        </>
      )}
    </div>
  )
}
