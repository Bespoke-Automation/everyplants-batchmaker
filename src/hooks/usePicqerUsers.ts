'use client'

import { useState, useEffect, useRef } from 'react'

export interface PicqerUserItem {
  iduser: number
  fullName: string
}

// Module-level cache so users are only fetched once across all components
let cachedUsers: PicqerUserItem[] | null = null
let fetchPromise: Promise<PicqerUserItem[]> | null = null

async function fetchUsersOnce(): Promise<PicqerUserItem[]> {
  if (cachedUsers) return cachedUsers

  if (!fetchPromise) {
    fetchPromise = fetch('/api/picqer/users')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch users')
        return res.json()
      })
      .then((data) => {
        const users: PicqerUserItem[] = (data.users ?? []).map(
          (u: { iduser: number; firstname: string; lastname: string }) => ({
            iduser: u.iduser,
            fullName: `${u.firstname} ${u.lastname}`.trim(),
          })
        )
        cachedUsers = users
        return users
      })
      .catch((err) => {
        fetchPromise = null
        throw err
      })
  }

  return fetchPromise
}

export function usePicqerUsers() {
  const [users, setUsers] = useState<PicqerUserItem[]>(cachedUsers ?? [])
  const [isLoading, setIsLoading] = useState(!cachedUsers)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    if (cachedUsers) {
      setUsers(cachedUsers)
      setIsLoading(false)
      return
    }

    fetchUsersOnce()
      .then((result) => {
        if (mountedRef.current) {
          setUsers(result)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (mountedRef.current) setIsLoading(false)
      })

    return () => {
      mountedRef.current = false
    }
  }, [])

  return { users, isLoading }
}
