import { Suspense } from 'react'
import { RefreshCw } from 'lucide-react'
import Header from '@/components/layout/Header'

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  )
}

export default function BatchmakerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <Header />
      <Suspense fallback={<LoadingState />}>
        {children}
      </Suspense>
    </div>
  )
}
