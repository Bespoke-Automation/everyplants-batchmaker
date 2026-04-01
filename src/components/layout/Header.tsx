'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Search, Bell, User, LogOut, Package } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'

export type Tab = 'batches' | 'single-orders' | 'settings'

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const { profile, signOut } = useAuth()
  const [workerName, setWorkerName] = useState<string | null>(null)
  const activeTab: Tab = pathname === '/batchmaker/single-orders' ? 'single-orders' : pathname === '/batchmaker/settings' ? 'settings' : 'batches'

  useEffect(() => {
    const readWorker = () => {
      try {
        const stored = localStorage.getItem('verpakking_worker')
        if (stored) {
          const parsed = JSON.parse(stored)
          setWorkerName(parsed.fullName || null)
        } else {
          setWorkerName(null)
        }
      } catch {
        setWorkerName(null)
      }
    }
    readWorker()

    const onWorkerChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setWorkerName(detail?.fullName || null)
    }

    window.addEventListener('storage', readWorker)
    window.addEventListener('worker-changed', onWorkerChanged)
    return () => {
      window.removeEventListener('storage', readWorker)
      window.removeEventListener('worker-changed', onWorkerChanged)
    }
  }, [])

  const handleLogout = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between sticky top-0 z-50">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
            <Package className="text-white w-5 h-5" />
          </div>
          <h1 className="text-lg font-bold tracking-tight">
            EveryPlants - Batchmaker
          </h1>
        </Link>
        <nav className="hidden md:flex items-center gap-4 text-sm font-medium">
          <Link
            href="/batchmaker/batches"
            className={`pb-1 px-1 transition-colors ${
              activeTab === 'batches'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Batches
          </Link>
          <Link
            href="/batchmaker/single-orders"
            className={`pb-1 px-1 transition-colors ${
              activeTab === 'single-orders'
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Single Orders
          </Link>
          <Link
            href="/batchmaker/settings"
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
        {(workerName || profile) && (
          <span className="hidden lg:flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="w-4 h-4" />
            {workerName || profile?.display_name}
          </span>
        )}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 pl-2 border-l border-border hover:text-destructive transition-colors"
          title="Uitloggen"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-sm font-medium hidden sm:inline-block">Uitloggen</span>
        </button>
      </div>
    </header>
  )
}
