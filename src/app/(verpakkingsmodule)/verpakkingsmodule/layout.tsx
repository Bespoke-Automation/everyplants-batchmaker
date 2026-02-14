'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Package, LogOut, ArrowLeft } from 'lucide-react'

const NAV_LINKS = [
  { href: '/verpakkingsmodule', label: 'Wachtrij' },
  { href: '/verpakkingsmodule/geschiedenis', label: 'Geschiedenis' },
  { href: '/verpakkingsmodule/engine-log', label: 'Engine Log' },
  { href: '/verpakkingsmodule/dashboard', label: 'Dashboard' },
  { href: '/verpakkingsmodule/instellingen', label: 'Instellingen' },
] as const

export default function VerpakkingsmoduleLayout({
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
    if (href === '/verpakkingsmodule') {
      return pathname === '/verpakkingsmodule'
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="h-screen h-dvh bg-background text-foreground flex flex-col font-sans overflow-hidden">
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
            <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center">
              <Package className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight hidden sm:block">Verpakkingsmodule</h1>
          </div>
          <nav className="flex items-center gap-1 ml-2">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  isActive(link.href)
                    ? 'bg-primary/10 text-primary font-medium'
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
