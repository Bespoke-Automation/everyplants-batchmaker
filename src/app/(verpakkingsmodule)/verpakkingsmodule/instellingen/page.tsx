'use client'

import { useState } from 'react'
import TagMappingSettings from '@/components/verpakking/TagMappingSettings'
import TagList from '@/components/verpakking/TagList'
import PackagingList from '@/components/verpakking/PackagingList'
import CompartmentRules from '@/components/verpakking/CompartmentRules'
import ProductStatus from '@/components/verpakking/ProductStatus'
import ShippingUnitList from '@/components/verpakking/ShippingUnitList'

const TABS = [
  { id: 'koppelingen', label: 'Koppelingen' },
  { id: 'tags', label: 'Tags' },
  { id: 'verpakkingen', label: 'Verpakkingen' },
  { id: 'compartimenten', label: 'Compartimenten' },
  { id: 'producten', label: 'Producten' },
  { id: 'verzendeenheden', label: 'Verzendeenheden' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function InstellingenPage() {
  const [activeTab, setActiveTab] = useState<TabId>('koppelingen')

  return (
    <main className="flex-1 p-6 overflow-y-auto">
      {/* Tab bar */}
      <div className="max-w-3xl mx-auto mb-6">
        <div className="flex flex-wrap gap-1 p-1 bg-muted rounded-lg">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
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
      {activeTab === 'producten' && <ProductStatus />}
      {activeTab === 'verzendeenheden' && <ShippingUnitList />}
    </main>
  )
}
