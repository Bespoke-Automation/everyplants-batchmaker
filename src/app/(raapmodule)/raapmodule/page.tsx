'use client'

import Link from 'next/link'
import { TreePine, Package2, Leaf, Flower, Settings } from 'lucide-react'

const CATEGORIES = [
  {
    href: '/raapmodule/buitenplanten',
    label: 'Buitenplanten',
    description: 'Export voor Adam + verwerking',
    icon: TreePine,
  },
  {
    href: '/raapmodule/potten',
    label: 'Potten',
    description: 'Raaplijst per vervoerder',
    icon: Package2,
  },
  {
    href: '/raapmodule/kamerplanten',
    label: 'Kamerplanten',
    description: 'Geconsolideerde raaplijst',
    icon: Leaf,
  },
  {
    href: '/raapmodule/kunstplanten',
    label: 'Kunstplanten',
    description: 'Geconsolideerde raaplijst',
    icon: Flower,
  },
]

export default function RaapmodulePage() {
  return (
    <main className="flex-1 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">Raapmodule</h2>
            <p className="text-muted-foreground mt-1">Kies een categorie om te rapen</p>
          </div>
          <Link
            href="/raapmodule/instellingen"
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <Settings className="w-4 h-4" />
            Instellingen
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            return (
              <Link
                key={cat.href}
                href={cat.href}
                className="group border border-border rounded-lg p-6 hover:border-primary hover:shadow-md transition-all bg-card"
              >
                <div className="w-12 h-12 bg-primary/10 group-hover:bg-primary/20 rounded-lg flex items-center justify-center mb-4 transition-colors">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-lg font-semibold">{cat.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{cat.description}</p>
              </Link>
            )
          })}
        </div>
      </div>
    </main>
  )
}
