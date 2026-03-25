'use client'

import { useState, useEffect, useSyncExternalStore, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

const TabLoading = () => (
  <div className="flex items-center justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
  </div>
)

const TagMappingSettings = dynamic(() => import('@/components/verpakking/TagMappingSettings'), { loading: TabLoading })
const TagList = dynamic(() => import('@/components/verpakking/TagList'), { loading: TabLoading })
const PackagingList = dynamic(() => import('@/components/verpakking/PackagingList'), { loading: TabLoading })
const CompartmentRules = dynamic(() => import('@/components/verpakking/CompartmentRules'), { loading: TabLoading })
const ProductStatus = dynamic(() => import('@/components/verpakking/ProductStatus'), { loading: TabLoading })
const ShippingUnitList = dynamic(() => import('@/components/verpakking/ShippingUnitList'), { loading: TabLoading })
const DefaultPackagingList = dynamic(() => import('@/components/verpakking/DefaultPackagingList'), { loading: TabLoading })
const PackingStationSettings = dynamic(() => import('@/components/verpakking/PackingStationSettings'), { loading: TabLoading })

const TABS = [
  { id: 'koppelingen', label: 'Koppelingen' },
  { id: 'tags', label: 'Tags' },
  { id: 'verpakkingen', label: 'Verpakkingen' },
  { id: 'compartimenten', label: 'Compartimenten' },
  { id: 'producten', label: 'Producten' },
  { id: 'verzendeenheden', label: 'Verzendeenheden' },
  { id: 'default-verpakkingen', label: 'Default Verpakkingen' },
  { id: 'werkstations', label: 'Werkstations' },
] as const

type TabId = (typeof TABS)[number]['id']

// Read hash client-side only to avoid hydration mismatch
function useHash(): string {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb)
      return () => window.removeEventListener('hashchange', cb)
    },
    () => window.location.hash.replace('#', ''),
    () => '', // server snapshot: empty
  )
}

export default function InstellingenPage() {
  const hash = useHash()
  const [activeTab, setActiveTab] = useState<TabId>('koppelingen')

  // Sync hash → tab on mount and hash changes
  useEffect(() => {
    if (hash && TABS.some((t) => t.id === hash)) {
      setActiveTab(hash as TabId)
    }
  }, [hash])

  useEffect(() => {
    window.location.hash = activeTab
  }, [activeTab])

  return (
    <main className="flex-1 px-4 sm:px-6 py-6 overflow-y-auto overflow-x-hidden">
      {/* Tab bar */}
      <div className="max-w-5xl mx-auto mb-6">
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
      {activeTab === 'default-verpakkingen' && <DefaultPackagingList />}
      {activeTab === 'werkstations' && <PackingStationSettings />}
    </main>
  )
}
