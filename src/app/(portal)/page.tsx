import Link from 'next/link'
import { Package, Box } from 'lucide-react'

export default function PortalPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">Welkom bij EveryPlants</h2>
          <p className="text-muted-foreground mt-1">Kies een module om te beginnen</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/batchmaker/batches"
            className="group border border-border rounded-lg p-6 hover:border-primary hover:shadow-md transition-all bg-card"
          >
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Batchmaker</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Order batch management en verwerking
            </p>
          </Link>

          <div className="relative border border-border rounded-lg p-6 bg-card opacity-60 cursor-not-allowed">
            <span className="absolute top-3 right-3 text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
              Binnenkort
            </span>
            <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mb-4">
              <Box className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">Verpakkingsmodule</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Verpakkingen beheren en toewijzen
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
