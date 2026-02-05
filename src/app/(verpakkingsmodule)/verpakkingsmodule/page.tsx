import { Box } from 'lucide-react'
import Link from 'next/link'

export default function VerpakkingsmodulePage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
          <Box className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Binnenkort beschikbaar</h2>
        <p className="text-muted-foreground mb-6">
          De verpakkingsmodule is momenteel in ontwikkeling.
        </p>
        <Link
          href="/"
          className="text-sm text-primary hover:underline"
        >
          Terug naar portal
        </Link>
      </div>
    </main>
  )
}
