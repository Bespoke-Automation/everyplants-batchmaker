'use client'

import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import FingerprintLibrary from '@/components/verpakking/insights/FingerprintLibrary'

export default function FingerprintLibraryPage() {
  return (
    <main className="flex-1 p-6 overflow-y-auto">
      <Suspense
        fallback={
          <div
            className="max-w-7xl mx-auto py-12 text-center text-muted-foreground"
            aria-live="polite"
            aria-busy="true"
          >
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Fingerprint library laden...
          </div>
        }
      >
        <FingerprintLibrary />
      </Suspense>
    </main>
  )
}
