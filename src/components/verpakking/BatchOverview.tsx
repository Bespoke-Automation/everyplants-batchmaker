'use client'

import { useCallback, useState, useRef, useEffect } from 'react'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  MessageSquare,
  StickyNote,
  Package,
  FileText,
  MoreHorizontal,
  Trash2,
  List,
  Plus,
  X,
  Search,
  Send,
  Eye,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { useBatchSession, type BatchComment } from '@/hooks/useBatchSession'
import { usePicqerUsers, type PicqerUserItem } from '@/hooks/usePicqerUsers'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import type { Worker, BatchPicklistItem, BatchProduct } from '@/types/verpakking'

interface BatchOverviewProps {
  batchSessionId: string
  worker: Worker
  onPicklistStarted: (sessionId: string) => void
  onBack: () => void
}

export default function BatchOverview({
  batchSessionId,
  worker,
  onPicklistStarted,
  onBack,
}: BatchOverviewProps) {
  const {
    batchSession,
    isLoading,
    error,
    isStartingPicklist,
    startPicklist,
    downloadPdf,
    downloadPackingListPdf,
    addPicklist,
    removePicklist,
    deleteBatch,
    reassignBatch,
    comments,
    isLoadingComments,
    fetchComments,
    addBatchComment,
    deleteBatchComment,
    picklistComments,
    refetch,
  } = useBatchSession(batchSessionId)

  const { users: picqerUsers } = usePicqerUsers()

  const [startError, setStartError] = useState<string | null>(null)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)
  const [isDownloadingPakbon, setIsDownloadingPakbon] = useState(false)
  const [showAddPicklist, setShowAddPicklist] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [commentsLoaded, setCommentsLoaded] = useState(false)
  const [showReassign, setShowReassign] = useState(false)
  const [isReassigning, setIsReassigning] = useState(false)
  const reassignRef = useRef<HTMLDivElement>(null)

  // Close reassign dropdown on click outside
  useEffect(() => {
    if (!showReassign) return
    const handleClick = (e: MouseEvent) => {
      if (reassignRef.current && !reassignRef.current.contains(e.target as Node)) {
        setShowReassign(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showReassign])

  const handleReassign = useCallback(async (user: { iduser: number; fullName: string }) => {
    setIsReassigning(true)
    try {
      await reassignBatch(user.iduser, user.fullName)
    } finally {
      setIsReassigning(false)
      setShowReassign(false)
    }
  }, [reassignBatch])

  // Load comments once when batchSession is available
  useEffect(() => {
    if (batchSession && !commentsLoaded) {
      setCommentsLoaded(true)
      fetchComments()
    }
  }, [batchSession, commentsLoaded, fetchComments])

  const handleStartPicklist = useCallback(
    async (item: BatchPicklistItem) => {
      setStartError(null)

      if (item.sessionId) {
        onPicklistStarted(item.sessionId)
        return
      }

      const result = await startPicklist(item.idpicklist, worker.iduser, worker.fullName)

      if (result.success && result.sessionId) {
        onPicklistStarted(result.sessionId)
      } else if (!result.success) {
        setStartError(result.error || 'Onbekende fout bij het starten')
      }
    },
    [startPicklist, worker.iduser, worker.fullName, onPicklistStarted]
  )

  const handleDownloadPdf = useCallback(async () => {
    setIsDownloadingPdf(true)
    try {
      await downloadPdf()
    } finally {
      setIsDownloadingPdf(false)
    }
  }, [downloadPdf])

  const handleDownloadPakbon = useCallback(async () => {
    setIsDownloadingPakbon(true)
    try {
      await downloadPackingListPdf()
    } finally {
      setIsDownloadingPakbon(false)
    }
  }, [downloadPackingListPdf])

  const handleDeleteBatch = useCallback(async () => {
    setIsDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteBatch()
      if (result.success) {
        onBack()
      } else {
        setDeleteError(result.error || 'Kon batch niet verwijderen')
      }
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [deleteBatch, onBack])

  // Loading state
  if (isLoading && !batchSession) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <p className="text-muted-foreground text-sm">Laden...</p>
      </div>
    )
  }

  // Error state
  if (error && !batchSession) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3">
        <AlertCircle className="w-8 h-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={refetch}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium text-sm hover:bg-primary/90 transition-colors min-h-[44px]"
        >
          <RefreshCw className="w-4 h-4" />
          Opnieuw
        </button>
      </div>
    )
  }

  if (!batchSession) return null

  const progressPercent = batchSession.totalPicklists > 0
    ? Math.round((batchSession.completedPicklists / batchSession.totalPicklists) * 100)
    : 0

  const isCompleted = batchSession.status === 'completed'

  // Use totalProducts from Picqer API (reliable), fallback to computed from products array
  const computedProductAmount = batchSession.products.reduce((sum, p) => sum + (p.amount || 0), 0)
  const totalProductAmount = batchSession.totalProducts || computedProductAmount || 0

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <div className="bg-card border-b border-border px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[44px]"
          >
            <ArrowLeft className="w-4 h-4" />
            Terug
          </button>

          <div className="flex items-center gap-2">
            {/* Batch PDF button */}
            <button
              onClick={handleDownloadPdf}
              disabled={isDownloadingPdf}
              className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[44px] disabled:opacity-50"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileText className="w-4 h-4" />
              )}
              Batch PDF
            </button>

            {/* Annuleer Batch button */}
            {!isCompleted && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/10 transition-colors text-sm font-medium min-h-[44px]"
              >
                <Trash2 className="w-4 h-4" />
                Annuleer Batch
              </button>
            )}

            {/* Refresh */}
            <button
              onClick={refetch}
              disabled={isLoading}
              className="p-2 border border-border rounded-lg hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Batch title */}
        <div className="mt-3">
          <div className="flex items-center gap-2.5">
            <h2 className="font-bold text-xl">Batch #{batchSession.batchDisplayId}</h2>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium leading-none ${
              isCompleted
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-blue-100 text-blue-700'
            }`}>
              {isCompleted ? (
                <>
                  <CheckCircle2 className="w-3 h-3" />
                  Afgerond
                </>
              ) : (
                'Open'
              )}
            </span>
            {batchSession.batchType === 'singles' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-purple-100 text-purple-700">
                Singles
              </span>
            )}
          </div>
          <div className="relative mt-1" ref={reassignRef}>
            <button
              onClick={() => setShowReassign(!showReassign)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Toegewezen aan <span className="font-medium text-foreground">{batchSession.assignedToName}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showReassign ? 'rotate-180' : ''}`} />
            </button>
            {showReassign && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-20 w-56 max-h-48 overflow-y-auto">
                {picqerUsers.map((user) => (
                  <button
                    key={user.iduser}
                    onClick={() => handleReassign(user)}
                    disabled={isReassigning}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50 first:rounded-t-lg last:rounded-b-lg ${
                      user.iduser === batchSession.assignedTo ? 'font-medium text-primary' : ''
                    }`}
                  >
                    {user.fullName}
                    {user.iduser === batchSession.assignedTo && ' (huidig)'}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Green summary banner */}
        <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <p className="text-sm text-emerald-800 font-medium">
            Batch aangemaakt met {totalProductAmount} producten en {batchSession.totalPicklists} picklijst{batchSession.totalPicklists !== 1 ? 'en' : ''}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{batchSession.completedPicklists}/{batchSession.totalPicklists} picklijsten verwerkt</span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${
                isCompleted ? 'bg-emerald-500' : 'bg-primary'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="mx-4 mt-3 border border-destructive/30 bg-destructive/5 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-destructive">Batch verwijderen?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Dit verwijdert de batch in Picqer. De picklijsten worden losgekoppeld en kunnen opnieuw gebatcht worden.
              </p>
              {deleteError && (
                <p className="text-xs text-destructive mt-1.5">{deleteError}</p>
              )}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleDeleteBatch}
                  disabled={isDeleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive text-destructive-foreground rounded-lg text-sm font-medium hover:bg-destructive/90 transition-colors min-h-[36px] disabled:opacity-50"
                >
                  {isDeleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Ja, verwijder
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeleteError(null) }}
                  disabled={isDeleting}
                  className="px-3 py-1.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors min-h-[36px]"
                >
                  Annuleren
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start error banner */}
      {startError && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 font-medium">{startError}</span>
          <button
            onClick={() => setStartError(null)}
            className="shrink-0 p-1 rounded hover:bg-destructive/20 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label="Sluiten"
          >
            &times;
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Card 1: Picklists */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Card header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold text-lg">
              Verwerk {batchSession.picklists.length} picklijst{batchSession.picklists.length !== 1 ? 'en' : ''}
            </h3>
            <div className="flex items-center gap-2">
              {!isCompleted && (
                <button
                  onClick={() => setShowAddPicklist(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[36px]"
                >
                  <Plus className="w-4 h-4" />
                  Toevoegen
                </button>
              )}
              <button
                onClick={handleDownloadPakbon}
                disabled={isDownloadingPakbon}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[36px] disabled:opacity-50"
              >
                {isDownloadingPakbon ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                Pakbonnen
              </button>
            </div>
          </div>

          {/* Add picklist inline form */}
          {showAddPicklist && (
            <AddPicklistForm
              onAdd={addPicklist}
              onClose={() => setShowAddPicklist(false)}
            />
          )}

          {/* Picklist rows */}
          {batchSession.picklists.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-muted-foreground text-sm">Geen picklijsten gevonden.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {batchSession.picklists.map((item) => (
                <PicklistRow
                  key={item.idpicklist}
                  item={item}
                  isStartingPicklist={isStartingPicklist}
                  onStart={handleStartPicklist}
                  onRemove={removePicklist}
                  batchId={batchSession.batchId}
                  allProducts={batchSession.products}
                  comments={picklistComments[item.idpicklist] ?? []}
                />
              ))}
            </div>
          )}

          {/* Card footer */}
          <div className="px-5 py-3 border-t border-border bg-muted/20 text-sm text-muted-foreground">
            {batchSession.picklists.length} picklijst{batchSession.picklists.length !== 1 ? 'en' : ''} · {totalProductAmount} producten
          </div>
        </div>

        {/* Card 2: Products */}
        {batchSession.products.length > 0 && (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-5 py-4 border-b border-border bg-muted/30">
              <h3 className="font-semibold text-lg">Producten</h3>
            </div>
            <div className="divide-y divide-border">
              {batchSession.products.map((product) => (
                <ProductRow key={product.idproduct} product={product} batchId={batchSession.batchId} />
              ))}
            </div>
          </div>
        )}

        {/* Card 3: Comments */}
        <CommentsCard
          comments={comments}
          isLoading={isLoadingComments}
          onAddComment={addBatchComment}
          onDeleteComment={deleteBatchComment}
          onRefresh={fetchComments}
          users={picqerUsers}
          currentUserName={worker.fullName}
        />
      </div>

      {/* Footer: batch completed */}
      {isCompleted && (
        <div className="border-t border-border bg-emerald-50 px-4 py-3 flex items-center justify-center">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium text-sm hover:bg-emerald-700 transition-colors min-h-[44px]"
          >
            <CheckCircle2 className="w-4 h-4" />
            Batch afgerond — Terug naar wachtrij
          </button>
        </div>
      )}
    </div>
  )
}

// ── Comments Card ──────────────────────────────────────────────────────────

function CommentsCard({
  comments,
  isLoading,
  onAddComment,
  onDeleteComment,
  onRefresh,
  users,
  currentUserName,
}: {
  comments: BatchComment[]
  isLoading: boolean
  onAddComment: (body: string) => Promise<{ success: boolean; error?: string }>
  onDeleteComment: (idcomment: number) => Promise<{ success: boolean; error?: string }>
  onRefresh: () => void
  users: PicqerUserItem[]
  currentUserName: string
}) {
  const [newComment, setNewComment] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const trimmed = newComment.trim()
    if (!trimmed) return

    setIsSending(true)
    setSendError(null)
    try {
      const result = await onAddComment(trimmed)
      if (result.success) {
        setNewComment('')
      } else {
        setSendError(result.error || 'Kon opmerking niet versturen')
      }
    } finally {
      setIsSending(false)
    }
  }

  const handleReply = (authorName: string) => {
    setNewComment((prev) => {
      const prefix = `@${authorName} `
      return prev ? `${prev}${prefix}` : prefix
    })
    textareaRef.current?.focus()
  }

  const handleDelete = async (idcomment: number) => {
    setDeletingId(idcomment)
    try {
      const result = await onDeleteComment(idcomment)
      if (!result.success) {
        setSendError(result.error || 'Kon opmerking niet verwijderen')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString('nl-NL', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const isOwnComment = (authorName: string) =>
    currentUserName && authorName.toLowerCase() === currentUserName.toLowerCase()

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Opmerkingen
          {comments.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">({comments.length})</span>
          )}
        </h3>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Existing comments */}
      {isLoading && comments.length === 0 ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Opmerkingen laden...
        </div>
      ) : comments.length > 0 ? (
        <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
          {comments.map((comment) => (
            <div key={comment.idcomment} className="group px-4 py-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{comment.authorName}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleReply(comment.authorName)}
                    className="px-2 py-0.5 text-xs border border-border rounded hover:bg-muted transition-colors"
                  >
                    Reageer
                  </button>
                  {isOwnComment(comment.authorName) && (
                    <button
                      onClick={() => handleDelete(comment.idcomment)}
                      disabled={deletingId === comment.idcomment}
                      className="px-2 py-0.5 text-xs border border-border rounded hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors disabled:opacity-50"
                    >
                      {deletingId === comment.idcomment ? 'Bezig...' : 'Verwijder'}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">{comment.body}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-4 text-sm text-muted-foreground">
          Nog geen opmerkingen.
        </div>
      )}

      {/* New comment input */}
      <div className="border-t border-border px-4 py-3">
        {sendError && (
          <p className="text-xs text-destructive mb-2">{sendError}</p>
        )}
        <div className="flex items-end gap-2">
          <MentionTextarea
            ref={textareaRef}
            value={newComment}
            onChange={setNewComment}
            onKeyDown={handleKeyDown}
            placeholder="Schrijf een opmerking... (@mention)"
            disabled={isSending}
            users={users}
          />
          <button
            onClick={handleSend}
            disabled={isSending || !newComment.trim()}
            className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-50"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Picklist Form ───────────────────────────────────────────────────────

interface SearchResult {
  idpicklist: number
  picklistid: string
  status: string
  totalproducts: number
  idpicklist_batch: number | null
}

function AddPicklistForm({
  onAdd,
  onClose,
}: {
  onAdd: (picklistId: number) => Promise<{ success: boolean; error?: string }>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isAdding, setIsAdding] = useState<number | null>(null)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const trimmed = query.trim()
    if (!trimmed) {
      setResults(null)
      setIsSearching(false)
      return
    }

    // Only search if at least 2 characters
    if (trimmed.length < 2) {
      setResults(null)
      return
    }

    setIsSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/picqer/picklists?picklistid=${encodeURIComponent(trimmed)}&limit=10`)
        if (res.ok) {
          const data = await res.json()
          const picklists: SearchResult[] = (data.picklists ?? []).map((pl: Record<string, unknown>) => ({
            idpicklist: pl.idpicklist,
            picklistid: pl.picklistid,
            status: pl.status,
            totalproducts: pl.totalproducts,
            idpicklist_batch: pl.idpicklist_batch ?? null,
          }))
          setResults(picklists)
        }
      } catch {
        // silently fail search
      } finally {
        setIsSearching(false)
      }
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const handleAdd = async (picklist: SearchResult) => {
    setAddError(null)

    if (picklist.idpicklist_batch) {
      setAddError(`${picklist.picklistid} zit al in een batch`)
      return
    }

    setIsAdding(picklist.idpicklist)
    try {
      const result = await onAdd(picklist.idpicklist)
      if (result.success) {
        setQuery('')
        setResults(null)
        onClose()
      } else {
        setAddError(result.error || 'Kon picklijst niet toevoegen')
      }
    } finally {
      setIsAdding(null)
    }
  }

  return (
    <div className="border-b border-border bg-blue-50/50 px-4 py-3">
      {/* Search input */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Zoek op picklijst nummer (bijv. P2026-11068)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary min-h-[36px]"
            disabled={isAdding !== null}
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 border border-border rounded-lg hover:bg-muted transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error */}
      {addError && (
        <p className="text-xs text-destructive mt-1.5">{addError}</p>
      )}

      {/* Search results */}
      {results !== null && (
        <div className="mt-2">
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Geen picklijsten gevonden voor &ldquo;{query.trim()}&rdquo;</p>
          ) : (
            <div className="border border-border rounded-lg bg-white divide-y divide-border overflow-hidden">
              {results.map((pl) => {
                const alreadyInBatch = !!pl.idpicklist_batch
                const isAddingThis = isAdding === pl.idpicklist

                return (
                  <div
                    key={pl.idpicklist}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${
                      alreadyInBatch ? 'opacity-50' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-primary">{pl.picklistid}</span>
                      <span className="text-muted-foreground ml-2">
                        {pl.totalproducts} producten
                      </span>
                      <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none ${
                        pl.status === 'new' ? 'bg-blue-100 text-blue-700' :
                        pl.status === 'closed' ? 'bg-gray-100 text-gray-600' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {pl.status}
                      </span>
                      {alreadyInBatch && (
                        <span className="ml-2 text-xs text-muted-foreground">(al in batch)</span>
                      )}
                    </div>
                    <button
                      onClick={() => handleAdd(pl)}
                      disabled={alreadyInBatch || isAddingThis}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition-colors min-h-[28px] disabled:opacity-50 shrink-0"
                    >
                      {isAddingThis ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Plus className="w-3 h-3" />
                      )}
                      Toevoegen
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Picklist Row ────────────────────────────────────────────────────────────

function PicklistRow({
  item,
  isStartingPicklist,
  onStart,
  onRemove,
  batchId,
  allProducts,
  comments,
}: {
  item: BatchPicklistItem
  isStartingPicklist: boolean
  onStart: (item: BatchPicklistItem) => void
  onRemove: (picklistId: number) => Promise<{ success: boolean; error?: string }>
  batchId: number
  allProducts: BatchProduct[]
  comments: BatchComment[]
}) {
  const isItemCompleted = item.sessionStatus === 'completed'
  const isClosed = item.status === 'closed'
  const canStart = !isItemCompleted && !isClosed

  // Combine all comment bodies into a single string (like Picqer does)
  const combinedComments = comments.map((c) => c.body).join(' ')

  return (
    <div
      className={`transition-colors ${
        isItemCompleted
          ? 'bg-emerald-50/50'
          : ''
      }`}
    >
      {/* Main row */}
      <div className="flex items-start gap-4 px-5 py-4 min-h-[72px]">
        {/* Alias letter */}
        <div className="relative shrink-0 mt-1">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold ${
            isItemCompleted
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-muted text-muted-foreground'
          }`}>
            {item.alias || '-'}
          </div>
          {isItemCompleted && (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute -bottom-0.5 -right-0.5 bg-white rounded-full" />
          )}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStart(item)}
              disabled={isStartingPicklist}
              className={`font-semibold text-base hover:underline text-left ${isItemCompleted ? 'text-emerald-600' : 'text-primary'}`}
            >
              {item.picklistid}
            </button>
            {item.hasCustomerRemarks && (
              <MessageSquare className="w-4 h-4 text-amber-500 shrink-0" />
            )}
            {item.hasNotes && (
              <StickyNote className="w-4 h-4 text-blue-500 shrink-0" />
            )}
          </div>
          <p className="text-sm text-foreground mt-0.5">{item.deliveryname}</p>

          {/* Customer remarks inline */}
          {item.customerRemarks && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded px-2.5 py-1.5 mt-2 line-clamp-2">
              {item.customerRemarks}
            </p>
          )}

          {/* Picklist comments inline — single line like Picqer */}
          {combinedComments && (
            <div className="mt-2">
              <div className="flex items-center gap-1 mb-0.5">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-sm font-semibold text-orange-500">Opmerkingen</span>
              </div>
              <p className="text-sm text-muted-foreground">{combinedComments}</p>
            </div>
          )}
        </div>

        {/* Amount */}
        <span className="text-base font-semibold text-muted-foreground shrink-0 tabular-nums mt-1">
          {item.totalproducts}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {isItemCompleted ? (
            <span className="inline-flex items-center gap-1 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-medium">
              <CheckCircle2 className="w-4 h-4" />
              Klaar
            </span>
          ) : canStart ? (
            <button
              onClick={() => onStart(item)}
              disabled={isStartingPicklist}
              className="inline-flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors min-h-[40px] disabled:opacity-50"
            >
              {isStartingPicklist ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Verwerk'
              )}
            </button>
          ) : (
            <span className="text-sm text-muted-foreground px-2">Dicht</span>
          )}

          {/* More dropdown */}
          <MoreDropdown
            picklistId={item.idpicklist}
            batchId={batchId}
            onRemove={() => onRemove(item.idpicklist)}
            isCompleted={isItemCompleted || isClosed}
          />
        </div>
      </div>
    </div>
  )
}

// ── More Dropdown ───────────────────────────────────────────────────────────

function MoreDropdown({
  picklistId,
  batchId,
  onRemove,
  isCompleted,
}: {
  picklistId: number
  batchId: number
  onRemove: () => Promise<{ success: boolean; error?: string }>
  isCompleted?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)
  const [showProducts, setShowProducts] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 })

  // Update dropdown position when opened
  useEffect(() => {
    if (!isOpen || !buttonRef.current) return

    const rect = buttonRef.current.getBoundingClientRect()
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.right - 200, // align right edge with button
    })
  }, [isOpen])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove()
    } finally {
      setIsRemoving(false)
      setIsOpen(false)
    }
  }

  const handleShowProducts = () => {
    setIsOpen(false)
    setShowProducts(true)
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {/* Portal dropdown to prevent overflow clipping */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-[100] bg-card border border-border rounded-lg shadow-lg py-1 min-w-[200px]"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
        >
          <button
            onClick={handleShowProducts}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
          >
            <Eye className="w-4 h-4" />
            Producten
          </button>
          {!isCompleted && (
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted transition-colors text-destructive disabled:opacity-50"
            >
              {isRemoving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Verwijder van batch
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Products modal */}
      {showProducts && (
        <PicklistProductsModal
          picklistId={picklistId}
          onClose={() => setShowProducts(false)}
        />
      )}
    </>
  )
}

// ── Picklist Products Modal ────────────────────────────────────────────────

interface PicklistProductItem {
  idproduct: number
  productcode: string
  name: string
  amount: number
  amount_picked: number
}

function PicklistProductsModal({
  picklistId,
  onClose,
}: {
  picklistId: number
  onClose: () => void
}) {
  const [products, setProducts] = useState<PicklistProductItem[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const res = await fetch(`/api/picqer/picklists/${picklistId}`)
        if (res.ok) {
          const data = await res.json()
          setProducts(data.picklist?.products ?? [])
        }
      } catch {
        // silently fail
      } finally {
        setIsLoading(false)
      }
    }

    fetchProducts()
  }, [picklistId])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    // Close on escape
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-semibold text-base">Producten in picklijst</h3>
          <button
            onClick={onClose}
            className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Producten laden...
            </div>
          ) : products && products.length > 0 ? (
            <div className="divide-y divide-border">
              {products.map((product) => (
                <div key={product.idproduct} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-10 h-10 rounded border border-border bg-muted/30 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground font-mono">{product.productcode}</p>
                    <p className="text-sm font-medium truncate">{product.name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-base font-bold tabular-nums">{product.amount}&times;</span>
                    {product.amount_picked > 0 && product.amount_picked < product.amount && (
                      <p className="text-xs text-muted-foreground">{product.amount_picked} gepickt</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              Geen producten gevonden.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Product Row ─────────────────────────────────────────────────────────────

function ProductRow({ product, batchId }: { product: BatchProduct; batchId: number }) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <div className="flex items-center gap-4 px-5 py-4">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded border border-border bg-muted/30 flex items-center justify-center shrink-0 overflow-hidden">
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <Package className="w-6 h-6 text-muted-foreground" />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground font-mono">{product.productcode}</p>
          <p className="text-base font-medium truncate">{product.name}</p>
        </div>

        {/* Stock location badge + Amount */}
        <div className="flex items-center gap-3 shrink-0">
          {product.stockLocation && (
            <span className="bg-muted text-muted-foreground rounded px-2 py-1 text-sm font-medium">
              {product.stockLocation}
            </span>
          )}
          <span className="text-lg font-bold tabular-nums">
            {product.amount}&times;
          </span>
        </div>

        {/* Picklists button */}
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-3 py-2 border border-border rounded-lg hover:bg-muted transition-colors text-sm font-medium min-h-[40px]"
          title="Picklijsten"
        >
          <List className="w-4 h-4 text-muted-foreground" />
          Picklijsten
        </button>
      </div>

      {showModal && (
        <ProductPicklistsModal
          batchId={batchId}
          product={product}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}

// ── Product Picklists Modal ──────────────────────────────────────────────────

interface ProductPicklistDetail {
  idpicklist: number
  picklistid: string
  alias?: string | null
  // Picqer returns both naming conventions depending on endpoint
  delivery_name?: string
  deliveryname?: string
  total_products?: number
  totalproducts?: number
  status: string
  reference?: string | null
  created_at?: string
  created?: string
}

function timeAgoShort(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMins = Math.round(diffMs / 60000)

  if (diffMins < 1) return 'nu'
  if (diffMins < 60) return `${diffMins} min geleden`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} uur geleden`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '1 dag geleden'
  return `${diffDays} dagen geleden`
}

function ProductPicklistsModal({
  batchId,
  product,
  onClose,
}: {
  batchId: number
  product: BatchProduct
  onClose: () => void
}) {
  const [picklists, setPicklists] = useState<ProductPicklistDetail[] | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchPicklists = async () => {
      try {
        const res = await fetch(
          `/api/picqer/picklist-batches/${batchId}/products/${product.idproduct}/picklists`
        )
        if (res.ok) {
          const data = await res.json()
          setPicklists(data.picklists ?? [])
        }
      } catch {
        // silently fail
      } finally {
        setIsLoading(false)
      }
    }

    fetchPicklists()
  }, [batchId, product.idproduct])

  // Close on click outside or escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="bg-card border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col"
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="font-semibold text-base">Picklijsten</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {product.productcode} — {product.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Picklijsten laden...
            </div>
          ) : picklists && picklists.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground w-12">Alias</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Picklijst</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Klant</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-center w-20">Producten</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground w-20">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Referentie</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-muted-foreground text-right">Besteld op</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {picklists.map((pl) => {
                  const customerName = pl.delivery_name || pl.deliveryname || '-'
                  const productCount = pl.total_products ?? pl.totalproducts ?? 0
                  const createdDate = pl.created_at || pl.created || ''

                  return (
                    <tr key={pl.idpicklist} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 font-bold text-muted-foreground">{pl.alias || '-'}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-primary">{pl.picklistid}</span>
                      </td>
                      <td className="px-4 py-2.5 truncate max-w-[180px]">{customerName}</td>
                      <td className="px-4 py-2.5 text-center tabular-nums">{productCount}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium leading-none ${
                          pl.status === 'new' || pl.status === 'processing'
                            ? 'bg-emerald-100 text-emerald-700'
                            : pl.status === 'closed'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-blue-100 text-blue-700'
                        }`}>
                          {pl.status === 'new' ? 'Open' :
                           pl.status === 'processing' ? 'Open' :
                           pl.status === 'closed' ? 'Dicht' :
                           pl.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[160px]">
                        {pl.reference || '-'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground text-xs whitespace-nowrap">
                        {createdDate ? timeAgoShort(createdDate) : '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-6 text-sm text-muted-foreground text-center">
              Geen picklijsten gevonden.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
