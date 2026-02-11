'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  ClipboardList,
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

interface PackingSession {
  id: string
  picklist_id: number
  picklistid: string
  assigned_to_name: string
  status: string
  created_at: string
  completed_at: string | null
}

interface SessionsResponse {
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
  pending: {
    label: 'Wachtend',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
  open: {
    label: 'Open',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
  closed: {
    label: 'Afgesloten',
    className: 'bg-gray-100 text-gray-800 border-gray-200',
  },
  shipment_created: {
    label: 'Zending aangemaakt',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  label_fetched: {
    label: 'Label opgehaald',
    className: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  shipped: {
    label: 'Verzonden',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  error: {
    label: 'Fout',
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

export default function SessionHistory() {
  const [sessions, setSessions] = useState<PackingSession[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const fetchSessions = useCallback(async (pageNum: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const offset = pageNum * PAGE_SIZE
      const response = await fetch(
        `/api/verpakking/sessions?limit=${PAGE_SIZE}&offset=${offset}`
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Kon sessies niet laden')
      }
      const data: SessionsResponse = await response.json()
      setSessions(data.sessions ?? [])
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

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Sessie Geschiedenis</h2>
            <p className="text-sm text-muted-foreground">
              Overzicht van alle packing sessies
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
      {isLoading && sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">Sessies laden...</p>
        </div>
      ) : sessions.length === 0 && !error ? (
        /* Empty state */
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Geen sessies</h3>
          <p className="text-sm text-muted-foreground">
            Er zijn nog geen packing sessies gevonden.
          </p>
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {/* Table header */}
            <div className="hidden sm:grid sm:grid-cols-[1fr_1fr_1fr_120px] gap-4 px-4 py-3 bg-muted/50 border-b border-border text-sm font-medium text-muted-foreground">
              <div>Datum</div>
              <div>Picklist</div>
              <div>Medewerker</div>
              <div>Status</div>
            </div>

            {/* Table rows */}
            <div className="divide-y divide-border">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="px-4 py-3 sm:grid sm:grid-cols-[1fr_1fr_1fr_120px] sm:gap-4 sm:items-center flex flex-col gap-2 hover:bg-muted/30 transition-colors"
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

                  {/* Picklist */}
                  <div>
                    <span className="sm:hidden text-xs text-muted-foreground font-medium">
                      Picklist:{' '}
                    </span>
                    <span className="text-sm font-mono">
                      {session.picklistid || session.picklist_id}
                    </span>
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

                  {/* Status */}
                  <div>
                    <span className="sm:hidden text-xs text-muted-foreground font-medium mr-1">
                      Status:{' '}
                    </span>
                    {getStatusBadge(session.status)}
                  </div>
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
            {total} sessie{total !== 1 ? 's' : ''} totaal
          </p>
        </>
      )}
    </div>
  )
}
