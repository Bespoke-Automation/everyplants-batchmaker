'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Loader2, Send, RefreshCw, MessageSquare } from 'lucide-react'
import { createPortal } from 'react-dom'
import { usePicqerUsers } from '@/hooks/usePicqerUsers'
import MentionTextarea from '@/components/verpakking/MentionTextarea'
import { useTranslation } from '@/i18n/LanguageContext'

interface Comment {
  idcomment: number
  body: string
  author: { full_name: string } | null
  created_at: string
}

interface BatchCommentsPopupProps {
  batchId: number
  batchDisplayId: string
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'zojuist'
  if (diffMin < 60) return `${diffMin} min geleden`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} uur geleden`
  const diffDays = Math.floor(diffHr / 24)
  return `${diffDays}d geleden`
}

export default function BatchCommentsPopup({
  batchId,
  batchDisplayId,
  anchorRef,
  onClose,
}: BatchCommentsPopupProps) {
  const { t } = useTranslation()
  const { users } = usePicqerUsers()
  const popupRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // Position state
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  // Calculate position relative to anchor
  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 8,
      left: Math.max(16, rect.left - 160), // center-ish, but don't go off-screen left
    })
  }, [anchorRef])

  // Fetch comments
  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/picqer/picklist-batches/${batchId}/comments`)
      if (res.ok) {
        const data = await res.json()
        setComments(data.comments ?? [])
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [batchId])

  useEffect(() => {
    fetchComments()
  }, [fetchComments])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleSend = useCallback(async () => {
    if (!newComment.trim() || isSending) return
    setIsSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/picqer/picklist-batches/${batchId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newComment.trim() }),
      })
      if (!res.ok) throw new Error('Failed')
      setNewComment('')
      await fetchComments()
    } catch {
      setSendError(t.batch.commentSendFailed)
    } finally {
      setIsSending(false)
    }
  }, [newComment, isSending, batchId, fetchComments, t.batch.commentSendFailed])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!position) return null

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-[100] bg-card border border-border rounded-xl shadow-xl w-[380px] max-h-[480px] flex flex-col"
      style={{ top: position.top, left: position.left }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Batch #{batchDisplayId}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchComments}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Comments list */}
      <div className="flex-1 overflow-y-auto max-h-[300px]">
        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : comments.length > 0 ? (
          <div className="divide-y divide-border">
            {comments.map((comment) => (
              <div key={comment.idcomment} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium">{comment.author?.full_name ?? 'Onbekend'}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(comment.created_at)}</span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{comment.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            {t.batch.noComments}
          </div>
        )}
      </div>

      {/* Input */}
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
            placeholder={t.batch.commentPlaceholder}
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
    </div>,
    document.body
  )
}
