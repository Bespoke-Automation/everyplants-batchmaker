'use client'

import { useState } from 'react'
import { Truck, MapPin } from 'lucide-react'
import PostalRegionsManager from '@/components/settings/PostalRegionsManager'
import VervoerderManager from '@/components/settings/VervoerderManager'

type SettingsTab = 'vervoerders' | 'postal-regions'

const TABS: { id: SettingsTab; label: string; icon: typeof Truck }[] = [
  { id: 'vervoerders', label: 'Vervoerders', icon: Truck },
  { id: 'postal-regions', label: 'Postcode Regios', icon: MapPin },
]

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('vervoerders')

  return (
    <main className="flex-1 p-6 space-y-6 overflow-auto">
      <h1 className="text-2xl font-bold">Instellingen</h1>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'vervoerders' && <VervoerderManager />}
      {activeTab === 'postal-regions' && <PostalRegionsManager />}
    </main>
  )
}
