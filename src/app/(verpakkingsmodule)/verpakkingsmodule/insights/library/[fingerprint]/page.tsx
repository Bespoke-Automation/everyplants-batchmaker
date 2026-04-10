'use client'

import { use } from 'react'
import { useSearchParams } from 'next/navigation'
import FingerprintDetail from '@/components/verpakking/insights/FingerprintDetail'

export default function FingerprintDetailPage({
  params,
}: {
  params: Promise<{ fingerprint: string }>
}) {
  const { fingerprint } = use(params)
  const searchParams = useSearchParams()
  const country = searchParams.get('country')

  return (
    <main className="flex-1 p-6 overflow-y-auto">
      <FingerprintDetail
        fingerprint={decodeURIComponent(fingerprint)}
        country={country}
      />
    </main>
  )
}
