'use client'

import Link from 'next/link'
import { Package, Box, Flower2, Shield, Leaf, ShoppingCart } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'

const MODULES = [
  {
    key: 'module_batchmaker' as const,
    href: '/batchmaker/batches',
    label: 'Batchmaker',
    description: 'Order batch management en verwerking',
    icon: Package,
    hoverBorder: 'hover:border-primary',
    iconBg: 'bg-primary/10 group-hover:bg-primary/20',
    iconColor: 'text-primary',
  },
  {
    key: 'module_raapmodule' as const,
    href: '/raapmodule',
    label: 'Raapmodule',
    description: 'Rapen per categorie en vervoerder',
    icon: Leaf,
    hoverBorder: 'hover:border-primary',
    iconBg: 'bg-primary/10 group-hover:bg-primary/20',
    iconColor: 'text-primary',
  },
  {
    key: 'module_verpakkingsmodule' as const,
    href: '/verpakkingsmodule',
    label: 'Verpakkingsmodule',
    description: 'Verpakkingen beheren en toewijzen',
    icon: Box,
    hoverBorder: 'hover:border-primary',
    iconBg: 'bg-primary/10 group-hover:bg-primary/20',
    iconColor: 'text-primary',
  },
  {
    key: 'module_bestellijst' as const,
    href: '/bestellijst',
    label: 'Bestellijst',
    description: 'Backorder overzicht voor inkoop',
    icon: ShoppingCart,
    hoverBorder: 'hover:border-amber-500',
    iconBg: 'bg-amber-500/10 group-hover:bg-amber-500/20',
    iconColor: 'text-amber-600',
  },
  {
    key: 'module_floriday' as const,
    href: '/floriday',
    label: 'Floriday Sync',
    description: 'Floriday orders naar Picqer',
    icon: Flower2,
    hoverBorder: 'hover:border-emerald-500',
    iconBg: 'bg-emerald-600/10 group-hover:bg-emerald-600/20',
    iconColor: 'text-emerald-600',
  },
]

export default function PortalPage() {
  const { profile, isLoading } = useAuth()

  if (isLoading) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </main>
    )
  }

  const visibleModules = MODULES.filter(m => profile?.[m.key])

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">Welkom bij EveryPlants</h2>
          <p className="text-muted-foreground mt-1">Kies een module om te beginnen</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {visibleModules.map((mod) => {
            const Icon = mod.icon
            return (
              <Link
                key={mod.key}
                href={mod.href}
                className={`group border border-border rounded-lg p-6 ${mod.hoverBorder} hover:shadow-md transition-all bg-card`}
              >
                <div className={`w-12 h-12 ${mod.iconBg} rounded-lg flex items-center justify-center mb-4 transition-colors`}>
                  <Icon className={`w-6 h-6 ${mod.iconColor}`} />
                </div>
                <h3 className="text-lg font-semibold">{mod.label}</h3>
                <p className="text-sm text-muted-foreground mt-1">{mod.description}</p>
              </Link>
            )
          })}

          {profile?.is_admin && (
            <Link
              href="/admin/users"
              className="group border border-border rounded-lg p-6 hover:border-amber-500 hover:shadow-md transition-all bg-card"
            >
              <div className="w-12 h-12 bg-amber-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
                <Shield className="w-6 h-6 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold">Beheer</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Gebruikers en toegang beheren
              </p>
            </Link>
          )}
        </div>
      </div>
    </main>
  )
}
