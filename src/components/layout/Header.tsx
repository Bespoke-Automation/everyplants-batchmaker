'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search, Bell, User, ChevronDown, Package, Settings } from 'lucide-react'

export type Tab = 'batches' | 'single-orders' | 'settings'

export default function Header() {
  const pathname = usePathname()
  const activeTab: Tab = pathname === '/single-orders' ? 'single-orders' : pathname === '/settings' ? 'settings' : 'batches'

  return (
    <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-6">
        <Link href="/batches" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
            <Package className="text-white w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">
            EveryPlants - Batchmaker
          </h1>
        </Link>
        <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
          <Link
            href="/batches"
            className={`pb-1 px-1 transition-colors ${
              activeTab === 'batches'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Batches
          </Link>
          <Link
            href="/single-orders"
            className={`pb-1 px-1 transition-colors ${
              activeTab === 'single-orders'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Single Orders
          </Link>
          <Link
            href="/settings"
            className={`pb-1 px-1 transition-colors ${
              activeTab === 'settings'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Instellingen
          </Link>
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden lg:block">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Snel zoeken..."
            className="pl-9 pr-4 h-9 w-64 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button className="p-2 hover:bg-muted rounded-full transition-colors relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full"></span>
        </button>
        <div className="flex items-center gap-2 pl-2 border-l border-border">
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
          <span className="text-sm font-medium hidden sm:inline-block">Admin User</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
    </header>
  )
}
