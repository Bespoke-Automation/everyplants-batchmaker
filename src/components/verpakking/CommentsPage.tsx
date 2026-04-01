'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { MessageSquare, Loader2, User as UserIcon, Send, Check, RotateCcw, ExternalLink } from 'lucide-react'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import { useTranslation } from '@/i18n/LanguageContext'

interface EnrichedComment {
  idcomment: number
  body: string
  displayBody: string
  displayAuthor: string
  displayAuthorId: number | null
  picqerAuthor: string
  picqerAuthorImage: string | null
  sourceType: string
  sourceId: number | null
  sourceReference: string | null
  sourceUrl: string | null
  mentions: Array<{ text: string; name: string; iduser: number }>
  isResolved: boolean
  createdAt: string
  isOurComment: boolean
}

type Tab = 'all' | 'mine' | 'mentions' | 'resolved'

const WORKER_STORAGE_KEY = 'verpakking_worker'

function getStoredWorker(): { iduser: number; fullName: string } | null {
  try {
    const stored = localStorage.getItem(WORKER_STORAGE_KEY)
    if (stored) {
      const worker = JSON.parse(stored)
      if (worker.iduser && worker.fullName) return worker
    }
  } catch { /* ignore */ }
  return null
}

function timeAgo(dateStr: string, labels: { justNow: string; minutesAgo: string; hoursAgo: string; yesterday: string; daysAgo: string }): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return labels.justNow
  if (minutes < 60) return `${minutes} ${labels.minutesAgo}`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${labels.hoursAgo}`
  const days = Math.floor(hours / 24)
  if (days === 1) return labels.yesterday
  return `${days} ${labels.daysAgo}`
}

function highlightMentions(body: string, mentions: EnrichedComment['mentions']): React.ReactNode[] {
  if (!mentions || mentions.length === 0) return [body]

  const positions: { start: number; end: number; text: string }[] = []
  for (const m of mentions) {
    const idx = body.indexOf(m.text)
    if (idx !== -1) {
      positions.push({ start: idx, end: idx + m.text.length, text: m.text })
    }
  }
  positions.sort((a, b) => a.start - b.start)
  if (positions.length === 0) return [body]

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  for (const pos of positions) {
    if (pos.start > lastIndex) parts.push(body.slice(lastIndex, pos.start))
    parts.push(
      <span key={pos.start} className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
        {pos.text}
      </span>
    )
    lastIndex = pos.end
  }
  if (lastIndex < body.length) parts.push(body.slice(lastIndex))
  return parts
}

function AuthorAvatar({ name, imageUrl }: { name: string; imageUrl?: string | null }) {
  if (imageUrl) {
    return <img src={imageUrl} alt={name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
  }
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500']
  const colorIdx = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length
  return (
    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${colors[colorIdx]}`}>
      {initials}
    </div>
  )
}

function SourceLink({ comment, t }: { comment: EnrichedComment; t: ReturnType<typeof useTranslation>['t'] }) {
  const label = comment.sourceReference
    || (comment.sourceType === 'picklist' ? `${t.comments.picklist} #${comment.sourceId}`
    : comment.sourceType === 'order' ? `${t.comments.order} #${comment.sourceId}`
    : comment.sourceType === 'picklist_batch' ? `${t.comments.batch} #${comment.sourceId}`
    : comment.sourceType || '?')

  if (comment.sourceUrl) {
    return (
      <a
        href={comment.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {label}
        <ExternalLink className="w-3 h-3" />
      </a>
    )
  }
  return <span className="text-xs text-muted-foreground">{label}</span>
}

export default function CommentsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('all')
  const [comments, setComments] = useState<EnrichedComment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { users } = usePicqerUsers()
  const { t } = useTranslation()

  const [worker, setWorker] = useState<{ iduser: number; fullName: string } | null>(null)
  const [workerLoaded, setWorkerLoaded] = useState(false)

  useEffect(() => {
    setWorker(getStoredWorker())
    setWorkerLoaded(true)
  }, [])

  const fetchComments = useCallback(async (tab: Tab) => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ tab })
      if (worker) params.set('workerId', String(worker.iduser))

      const res = await fetch(`/api/verpakking/comments?${params}`)
      if (!res.ok) throw new Error('Ophalen opmerkingen mislukt')
      const data = await res.json()
      setComments(data.comments ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setIsLoading(false)
    }
  }, [worker])

  useEffect(() => {
    fetchComments(activeTab)
  }, [activeTab, fetchComments])

  // Reply state
  const [replyTo, setReplyTo] = useState<EnrichedComment | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isSending, setIsSending] = useState(false)

  const handleSendReply = useCallback(async () => {
    if (!replyTo || !replyText.trim() || !worker) return
    setIsSending(true)
    try {
      const res = await fetch('/api/verpakking/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: replyText,
          workerId: worker.iduser,
          workerName: worker.fullName,
          entityType: replyTo.sourceType,
          entityId: replyTo.sourceId,
          entityReference: replyTo.sourceReference,
        }),
      })
      if (!res.ok) throw new Error('Reactie plaatsen mislukt')
      setReplyText('')
      setReplyTo(null)
      await fetchComments(activeTab)
    } catch (err) {
      console.error('Failed to send reply:', err)
    } finally {
      setIsSending(false)
    }
  }, [replyTo, replyText, worker, activeTab, fetchComments])

  // Resolve/unresolve
  const handleResolve = useCallback(async (idcomment: number) => {
    if (!worker) return
    const res = await fetch('/api/verpakking/comments/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idcomment, workerId: worker.iduser }),
    })
    if (res.ok) {
      setComments(prev => prev.filter(c => c.idcomment !== idcomment))
    }
  }, [worker])

  const handleUnresolve = useCallback(async (idcomment: number) => {
    if (!worker) return
    const res = await fetch('/api/verpakking/comments/resolve', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idcomment, workerId: worker.iduser }),
    })
    if (res.ok) {
      setComments(prev => prev.filter(c => c.idcomment !== idcomment))
    }
  }, [worker])

  const tabs: { key: Tab; label: string }[] = useMemo(() => [
    { key: 'all', label: t.comments.allComments },
    { key: 'mine', label: t.comments.myComments },
    { key: 'mentions', label: worker ? `@${worker.fullName}` : '@Mij' },
    { key: 'resolved', label: t.comments.resolved ?? 'Afgerond' },
  ], [worker, t])

  if (!workerLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!worker) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <UserIcon className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-lg font-semibold">{t.comments.noWorker}</p>
          <p className="text-sm text-muted-foreground">{t.comments.noWorkerHint}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          {t.comments.title}
        </h1>
      </div>

      {/* Tabs */}
      <div className="border-b border-border bg-card">
        <div className="flex px-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-600">{error}</div>
        ) : comments.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">
              {activeTab === 'all' ? t.comments.noComments
                : activeTab === 'mine' ? t.comments.noMyComments
                : activeTab === 'mentions' ? t.comments.noMentions
                : t.comments.noResolved ?? 'Geen afgeronde opmerkingen'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {comments.map((comment) => {
              const isReplying = replyTo?.idcomment === comment.idcomment
              const isMentionedTab = activeTab === 'mentions'
              const isResolvedTab = activeTab === 'resolved'

              return (
                <div key={comment.idcomment} className={`px-4 py-3 hover:bg-muted/30 transition-colors ${comment.isResolved && !isResolvedTab ? 'opacity-50' : ''}`}>
                  <div className="flex gap-3">
                    <AuthorAvatar
                      name={comment.displayAuthor}
                      imageUrl={comment.isOurComment ? null : comment.picqerAuthorImage}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{comment.displayAuthor}</span>
                        <span className="text-xs text-muted-foreground">{t.comments.at}</span>
                        <SourceLink comment={comment} t={t} />
                        <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt, t.comments)}</span>
                      </div>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">
                        {highlightMentions(comment.displayBody, comment.mentions)}
                      </p>

                      {/* Actions row */}
                      <div className="flex items-center gap-3 mt-1">
                        {comment.sourceId && (
                          <button
                            onClick={() => setReplyTo(isReplying ? null : comment)}
                            className="text-xs text-muted-foreground hover:text-primary transition-colors"
                          >
                            {t.comments.reply}
                          </button>
                        )}

                        {/* Resolve button — on mentions tab */}
                        {isMentionedTab && !comment.isResolved && (
                          <button
                            onClick={() => handleResolve(comment.idcomment)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-green-600 transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {t.comments.markDone ?? 'Afvinken'}
                          </button>
                        )}

                        {/* Unresolve button — on resolved tab */}
                        {isResolvedTab && (
                          <button
                            onClick={() => handleUnresolve(comment.idcomment)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-amber-600 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {t.comments.markOpen ?? 'Heropenen'}
                          </button>
                        )}
                      </div>

                      {/* Inline reply form */}
                      {isReplying && (
                        <div className="mt-2 flex gap-2">
                          <MentionTextarea
                            value={replyText}
                            onChange={setReplyText}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSendReply()
                              }
                            }}
                            placeholder={t.comments.replyPlaceholder}
                            disabled={isSending}
                            users={users}
                            className="flex-1 resize-none border border-border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary min-h-[36px] max-h-[100px]"
                          />
                          <button
                            onClick={handleSendReply}
                            disabled={isSending || !replyText.trim()}
                            className="px-3 py-2 min-h-[36px] bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
