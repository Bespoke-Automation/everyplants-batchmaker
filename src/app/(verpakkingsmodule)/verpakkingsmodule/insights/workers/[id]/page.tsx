'use client'

import { use } from 'react'
import WorkerDetail from '@/components/verpakking/insights/WorkerDetail'

export default function WorkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  return (
    <main className="flex-1 p-6 overflow-y-auto">
      <WorkerDetail workerId={Number(id)} />
    </main>
  )
}
