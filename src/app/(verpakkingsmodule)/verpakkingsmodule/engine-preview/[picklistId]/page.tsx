'use client'

import { use } from 'react'
import { useRouter } from 'next/navigation'
import EnginePreviewPanel from '@/components/verpakking/EnginePreviewPanel'

export default function EnginePreviewPage({ params }: { params: Promise<{ picklistId: string }> }) {
  const { picklistId: picklistIdStr } = use(params)
  const picklistId = parseInt(picklistIdStr, 10)
  const router = useRouter()

  if (isNaN(picklistId)) {
    router.replace('/verpakkingsmodule')
    return null
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="w-full flex-1 flex flex-col overflow-y-auto">
        <EnginePreviewPanel
          picklistId={picklistId}
          picklistDisplayId={picklistIdStr}
          onBack={() => {
            if (window.history.length > 1) {
              router.back()
            } else {
              router.push('/verpakkingsmodule')
            }
          }}
        />
      </div>
    </main>
  )
}
