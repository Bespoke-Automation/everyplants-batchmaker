'use client'

interface FooterProps {
  fetchedAt?: string
}

export default function Footer({ fetchedAt }: FooterProps) {
  const formatTime = (isoString?: string) => {
    if (!isoString) return 'Never'
    const date = new Date(isoString)
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <footer className="h-8 border-t border-border bg-card px-4 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-success rounded-full animate-pulse"></span>
          System Online
        </div>
        <div>Version 2.0.0-next</div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          Last sync: <span className="text-foreground">{formatTime(fetchedAt)}</span>
        </div>
        <div className="flex items-center gap-1">
          Branch: <span className="text-foreground">production</span>
        </div>
      </div>
    </footer>
  )
}
