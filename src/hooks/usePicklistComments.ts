'use client'

import { useCallback } from 'react'
import useSWR from 'swr'

export interface PicklistComment {
  idcomment: number
  body: string
  authorType: string
  authorName: string
  authorImageUrl: string | null
  createdAt: string
}

interface RawComment {
  idcomment: number
  body: string
  author_type: string
  author: { full_name: string; image_url: string | null }
  created_at: string
}

function mapComments(raw: RawComment[]): PicklistComment[] {
  return raw.map((c) => ({
    idcomment: c.idcomment,
    body: c.body,
    authorType: c.author_type,
    authorName: c.author?.full_name ?? 'Onbekend',
    authorImageUrl: c.author?.image_url ?? null,
    createdAt: c.created_at,
  }))
}

export function usePicklistComments(picklistId: number | null) {
  const { data, isLoading, mutate } = useSWR<{ comments: RawComment[] }>(
    picklistId ? `/api/picqer/picklists/${picklistId}/comments` : null
  )

  const comments = mapComments(data?.comments ?? [])

  const fetchComments = useCallback(() => mutate(), [mutate])

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
          const resData = await res.json()
          return { success: false, error: resData.error || 'Failed to add comment' }
        }

        await mutate()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [picklistId, mutate]
  )

  const deleteComment = useCallback(
    async (idcomment: number): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch(`/api/picqer/comments/${idcomment}`, {
          method: 'DELETE',
        })

        if (!res.ok && res.status !== 204) {
          const resData = await res.json().catch(() => ({}))
          return { success: false, error: (resData as { error?: string }).error || 'Failed to delete comment' }
        }

        await mutate()
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    },
    [mutate]
  )

  return { comments, isLoading, fetchComments, addComment, deleteComment }
}
