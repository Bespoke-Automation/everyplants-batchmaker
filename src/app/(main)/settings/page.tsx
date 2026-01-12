import PostalRegionsManager from '@/components/settings/PostalRegionsManager'

export default function SettingsPage() {
  return (
    <main className="flex-1 p-6 space-y-6 overflow-auto">
      <h1 className="text-2xl font-bold">Instellingen</h1>
      <PostalRegionsManager />
    </main>
  )
}
