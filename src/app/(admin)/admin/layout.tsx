'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Shield, LogOut, ArrowLeft, User } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const { profile, isLoading, signOut } = useAuth()

  const handleLogout = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!profile?.is_admin) {
    router.replace('/')
    return null
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
            <div className="w-8 h-8 bg-amber-500 rounded-md flex items-center justify-center">
              <Shield className="text-white w-5 h-5" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">Beheer</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {profile && (
            <span className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="w-4 h-4" />
              {profile.display_name}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 hover:text-destructive transition-colors"
            title="Uitloggen"
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline-block">Uitloggen</span>
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}
