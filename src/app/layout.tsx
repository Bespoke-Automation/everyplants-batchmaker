import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EveryPlants - Batchmaker',
  description: 'Order batch management system for EveryPlants',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground font-sans">
        {children}
      </body>
    </html>
  )
}
