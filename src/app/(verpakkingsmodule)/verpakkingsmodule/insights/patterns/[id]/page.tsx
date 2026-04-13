'use client'

import { use } from 'react'
import LearnedPatternDetailView from '@/components/verpakking/insights/LearnedPatternDetail'

export default function LearnedPatternDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  return (
    <main className="flex-1 p-6 overflow-y-auto">
      <LearnedPatternDetailView id={id} />
    </main>
  )
}
