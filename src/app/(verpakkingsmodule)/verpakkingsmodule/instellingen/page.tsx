'use client'

import { useState } from 'react'
import TagMappingSettings from '@/components/verpakking/TagMappingSettings'
import TagList from '@/components/verpakking/TagList'
import PackagingList from '@/components/verpakking/PackagingList'
import CompartmentRules from '@/components/verpakking/CompartmentRules'

const TABS = [
  { id: 'koppelingen', label: 'Koppelingen' },
  { id: 'tags', label: 'Tags' },
  { id: 'verpakkingen', label: 'Verpakkingen' },
  { id: 'compartimenten', label: 'Compartimenten' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function InstellingenPage() {
  const [activeTab, setActiveTab] = useState<TabId>('koppelingen')

  return (
    <main className="flex-1 p-6 overflow-y-auto">
      {/* Tab bar */}
      <div className="max-w-3xl mx-auto mb-6">
        <div className="flex gap-1 p-1 bg-muted rounded-lg">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === tab.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'koppelingen' && <TagMappingSettings />}
      {activeTab === 'tags' && <TagList />}
      {activeTab === 'verpakkingen' && <PackagingList />}
      {activeTab === 'compartimenten' && <CompartmentRules />}
    </main>
  )
}
