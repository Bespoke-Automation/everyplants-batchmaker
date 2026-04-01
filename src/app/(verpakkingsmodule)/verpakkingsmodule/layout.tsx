'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Package, LogOut, ArrowLeft, User, MessageSquare } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthProvider'
import { LanguageProvider, useTranslation } from '@/i18n/LanguageContext'

function LanguageSwitcher() {
  const { language, setLanguage } = useTranslation()
  return (
    <button
      onClick={() => setLanguage(language === 'nl' ? 'en' : 'nl')}
      className="px-2 py-1 text-xs font-semibold border border-border rounded-md hover:bg-muted transition-colors text-muted-foreground"
      title={language === 'nl' ? 'Switch to English' : 'Wissel naar Nederlands'}
    >
      {language === 'nl' ? 'EN' : 'NL'}
    </button>
  )
}

function LayoutContent({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile, signOut } = useAuth()
  const { t } = useTranslation()

  const NAV_LINKS = [
    { href: '/verpakkingsmodule', label: t.layout.queue },
    { href: '/verpakkingsmodule/geschiedenis', label: t.layout.history },
    { href: '/verpakkingsmodule/engine-log', label: t.layout.engineLog },
    { href: '/verpakkingsmodule/dashboard', label: t.layout.dashboard },
    { href: '/verpakkingsmodule/instellingen', label: t.layout.settings },
  ]

  const handleLogout = async () => {
    await signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/verpakkingsmodule') {
      return pathname === '/verpakkingsmodule'
        || pathname.startsWith('/verpakkingsmodule/batch/')
        || pathname.startsWith('/verpakkingsmodule/picklist/')
        || pathname.startsWith('/verpakkingsmodule/engine-preview/')
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
            {t.layout.portal}
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
        <div className="flex items-center gap-3">
          <Link
            href="/verpakkingsmodule/opmerkingen"
            className={`p-2 rounded-lg transition-colors ${
              pathname.startsWith('/verpakkingsmodule/opmerkingen')
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title={t.layout.comments}
          >
            <MessageSquare className="w-5 h-5" />
          </Link>
          <LanguageSwitcher />
          {profile && (
            <span className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="w-4 h-4" />
              {profile.display_name}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 hover:text-destructive transition-colors"
            title={t.layout.logout}
          >
            <LogOut className="w-5 h-5" />
            <span className="text-sm font-medium hidden sm:inline-block">{t.layout.logout}</span>
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}

export default function VerpakkingsmoduleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <LanguageProvider>
      <LayoutContent>{children}</LayoutContent>
    </LanguageProvider>
  )
}
