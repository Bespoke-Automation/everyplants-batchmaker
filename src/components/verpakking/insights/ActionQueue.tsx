'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  RefreshCw,
  AlertTriangle,
  Target,
  HelpCircle,
  Sparkles,
  Clock,
  X,
  Check,
  ChevronDown,
} from 'lucide-react'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { InsightAction, InsightActionType } from '@/lib/engine/insightsActions'

const TYPE_META: Record<
  InsightActionType,
  { label: string; icon: typeof AlertTriangle; cls: string }
> = {
  drifting_pattern: {
    label: 'Patroon drift',
    icon: AlertTriangle,
    cls: 'bg-red-50 text-red-700 border-red-200',
  },
  no_match_fingerprint: {
    label: 'Geen advies',
    icon: Target,
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  unclassified_products: {
    label: 'Classificatie',
    icon: HelpCircle,
    cls: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  newly_promoted: {
    label: 'Nieuw geleerd',
    icon: Sparkles,
    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
}

export default function ActionQueue() {
  const [actions, setActions] = useState<InsightAction[]>([])
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmTitle, setConfirmTitle] = useState('')
  const [confirmMessage, setConfirmMessage] = useState('')
  const [confirmVariant, setConfirmVariant] = useState<'default' | 'destructive'>('default')
  const [confirmLoading, setConfirmLoading] = useState(false)
  const [confirmBtnText, setConfirmBtnText] = useState('Bevestigen')
  const confirmActionRef = useRef<(() => Promise<void>) | null>(null)

  const fetchActions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/verpakking/insights/actions?status=active&limit=5')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setActions(data.actions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActions()
  }, [fetchActions])

  const handleDetect = async () => {
    setDetecting(true)
    setError(null)
    try {
      const res = await fetch('/api/verpakking/insights/actions/detect', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await fetchActions()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detectie mislukt')
    } finally {
      setDetecting(false)
    }
  }

  const handleActionApi = async (actionId: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/verpakking/insights/actions/${actionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? res.statusText)
    }
  }

  const requestConfirm = (
    title: string,
    message: string,
    variant: 'default' | 'destructive',
    btnText: string,
    onConfirm: () => Promise<void>,
  ) => {
    setConfirmTitle(title)
    setConfirmMessage(message)
    setConfirmVariant(variant)
    setConfirmBtnText(btnText)
    confirmActionRef.current = async () => {
      setConfirmLoading(true)
      try {
        await onConfirm()
        await fetchActions()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Actie mislukt')
      } finally {
        setConfirmLoading(false)
        setConfirmOpen(false)
      }
    }
    setConfirmOpen(true)
  }

  if (loading && actions.length === 0) {
    return null // Don't show empty skeleton on first load
  }

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Aanbevolen acties</h2>
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          title="Scan opnieuw voor nieuwe acties"
        >
          <RefreshCw className={`w-3 h-3 ${detecting ? 'animate-spin' : ''}`} />
          Detecteer acties
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 mb-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {actions.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <Check className="w-6 h-6 mx-auto mb-2 text-emerald-500" />
          Geen openstaande acties. Klik &quot;Detecteer acties&quot; om te scannen.
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => {
            const meta = TYPE_META[action.type] ?? TYPE_META.no_match_fingerprint
            const TypeIcon = meta.icon

            return (
              <div
                key={action.id}
                className="flex items-start gap-3 p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.cls}`}
                >
                  <TypeIcon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{action.title}</p>
                  {action.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {action.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.cls}`}>
                      {meta.label}
                    </span>
                    {action.volume > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        {action.volume} {action.volume === 1 ? 'order' : 'orders'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {/* Link to relevant page if fingerprint/pattern exists */}
                  {action.type === 'drifting_pattern' &&
                    typeof action.payload?.pattern_id === 'string' && (
                      <Link
                        href={`/verpakkingsmodule/insights/patterns/${action.payload.pattern_id}`}
                        className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                      >
                        Bekijk
                      </Link>
                    )}
                  {action.type === 'no_match_fingerprint' && action.fingerprint && (
                    <Link
                      href={`/verpakkingsmodule/insights/library/${encodeURIComponent(action.fingerprint)}${action.country ? `?country=${action.country}` : ''}`}
                      className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                    >
                      Bekijk
                    </Link>
                  )}

                  {/* Complete (mark as done) */}
                  <button
                    onClick={() =>
                      requestConfirm(
                        'Actie afhandelen?',
                        `Markeer "${action.title}" als afgehandeld.`,
                        'default',
                        'Afhandelen',
                        async () => handleActionApi(action.id, { action: 'complete' }),
                      )
                    }
                    className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                    title="Markeer als afgehandeld"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>

                  {/* Snooze dropdown */}
                  <SnoozeMenu
                    onSnooze={(duration) =>
                      requestConfirm(
                        'Actie uitstellen?',
                        `"${action.title}" uitstellen voor ${duration === '24h' ? '24 uur' : duration === '7d' ? '7 dagen' : 'permanent'}.`,
                        'default',
                        'Uitstellen',
                        async () =>
                          handleActionApi(action.id, { action: 'snooze', duration }),
                      )
                    }
                  />

                  {/* Dismiss */}
                  <button
                    onClick={() =>
                      requestConfirm(
                        'Actie negeren?',
                        `"${action.title}" permanent negeren. Je kunt dit niet ongedaan maken.`,
                        'destructive',
                        'Negeren',
                        async () => handleActionApi(action.id, { action: 'dismiss' }),
                      )
                    }
                    className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Negeer deze actie"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false)
          setConfirmLoading(false)
        }}
        onConfirm={async () => {
          if (confirmActionRef.current) await confirmActionRef.current()
        }}
        title={confirmTitle}
        message={confirmMessage}
        variant={confirmVariant}
        isLoading={confirmLoading}
        confirmText={confirmBtnText}
      />
    </section>
  )
}

function SnoozeMenu({
  onSnooze,
}: {
  onSnooze: (duration: '24h' | '7d' | 'forever') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 text-muted-foreground hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
        title="Uitstellen"
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-10 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[140px]">
          <button
            onClick={() => {
              onSnooze('24h')
              setOpen(false)
            }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors"
          >
            24 uur
          </button>
          <button
            onClick={() => {
              onSnooze('7d')
              setOpen(false)
            }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors"
          >
            7 dagen
          </button>
          <button
            onClick={() => {
              onSnooze('forever')
              setOpen(false)
            }}
            className="w-full px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors"
          >
            Permanent
          </button>
        </div>
      )}
    </div>
  )
}
