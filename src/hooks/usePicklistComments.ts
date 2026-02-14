'use client'

import { useState, useCallback, useRef } from 'react'

export interface PicklistComment {
  idcomment: number
  body: string
  authorType: string
  authorName: string
  authorImageUrl: string | null
  createdAt: string
}

export function usePicklistComments(picklistId: number | null) {
  const [comments, setComments] = useState<PicklistComment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  const fetchComments = useCallback(async () => {
    if (!picklistId) return

    setIsLoading(true)
    try {
      const res = await fetch(`/api/picqer/picklists/${picklistId}/comments`)
      if (res.ok) {
        const data = await res.json()
        const mapped: PicklistComment[] = (data.comments ?? []).map(
          (c: {
            idcomment: number
            body: string
            author_type: string
            author: { full_name: string; image_url: string | null }
            created_at: string
          }) => ({
            idcomment: c.idcomment,
            body: c.body,
            authorType: c.author_type,
            authorName: c.author?.full_name ?? 'Onbekend',
            authorImageUrl: c.author?.image_url ?? null,
            createdAt: c.created_at,
          })
        )
        if (mountedRef.current) setComments(mapped)
      }
    } catch {
      // silently fail
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [picklistId])

  const addComment = useCallback(
    async (body: string): Promise<{ success: boolean; error?: string }> => {
      if (!picklistId) return { success: false, error: 'No picklist ID' }

      try {
        const res = await fetch(`/api/picqer/picklists/${picklistId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        })

        if (!res.ok) {
          const data = await res.json()
          return { success: false, error: data.error || 'Failed to add comment' }
        }

        await fetchComments()
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
    [picklistId, fetchComments]
  )

  const deleteComment = useCallback(
    async (idcomment: number): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/picqer/comments/${idcomment}`, {
          method: 'DELETE',
        })

        if (!res.ok && res.status !== 204) {
          const data = await res.json().catch(() => ({}))
          return { success: false, error: (data as { error?: string }).error || 'Failed to delete comment' }
        }

        await fetchComments()
        return { success: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return { success: false, error: message }
      }
    },
    [fetchComments]
  )

  return { comments, isLoading, fetchComments, addComment, deleteComment }
}
