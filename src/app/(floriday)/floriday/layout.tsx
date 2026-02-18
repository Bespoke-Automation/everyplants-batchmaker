'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Package, LogOut, ArrowLeft } from 'lucide-react'

const NAV_LINKS = [
  { href: '/floriday', label: 'Dashboard' },
  { href: '/floriday/orders', label: 'Orders' },
  { href: '/floriday/logs', label: 'Sync Log' },
] as const

export default function FloridayLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/floriday') {
      return pathname === '/floriday'
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="h-14 border-b border-border bg-card px-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Portal
          </Link>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-600 rounded-md flex items-center justify-center">
              <Package className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight hidden sm:block">Floriday Sync</h1>
          </div>
          <nav className="flex items-center gap-1 ml-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  isActive(link.href)
                    ? 'bg-emerald-600/10 text-emerald-600 font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 hover:text-destructive transition-colors"
          title="Uitloggen"
        >
          <LogOut className="w-5 h-5" />
          <span className="text-sm font-medium hidden sm:inline-block">Uitloggen</span>
        </button>
      </header>
      {children}
    </div>
  )
}
