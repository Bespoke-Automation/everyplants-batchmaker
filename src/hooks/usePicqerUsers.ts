'use client'

import useSWR from 'swr'

export interface PicqerUserItem {
  iduser: number
  fullName: string
}

interface PicqerUserRaw {
  iduser: number
  firstname: string
  lastname: string
}

export function usePicqerUsers() {
  const { data, isLoading } = useSWR<{ users: PicqerUserRaw[] }>(
    '/api/picqer/users',
    {
      revalidateOnFocus: false,
      dedupingInterval: 300_000, // 5 minutes — users rarely change
    }
  )

  const users: PicqerUserItem[] = (data?.users ?? []).map((u) => ({
    iduser: u.iduser,
    fullName: `${u.firstname} ${u.lastname}`.trim(),
  }))

  return { users, isLoading }
}
