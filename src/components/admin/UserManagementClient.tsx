'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth, type UserProfile } from '@/components/providers/AuthProvider'

export default function UserManagementClient() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const fetchProfiles = useCallback(async () => {
    const res = await fetch('/api/admin/users')
    if (res.ok) {
      const data = await res.json()
      setProfiles(data.profiles)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  const toggleField = async (profileId: string, field: string, value: boolean) => {
    // Prevent removing own admin
    if (field === 'is_admin' && profileId === user?.id && !value) return

    setSaving(profileId)
    const res = await fetch(`/api/admin/users/${profileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })

    if (res.ok) {
      setProfiles(prev =>
        prev.map(p => p.id === profileId ? { ...p, [field]: value } : p)
      )
    }
    setSaving(null)
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="flex-1 p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold mb-6">Gebruikersbeheer</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 text-sm text-muted-foreground">
                <th className="text-left px-4 py-3 font-medium">Naam</th>
                <th className="text-left px-4 py-3 font-medium">E-mail</th>
                <th className="text-center px-4 py-3 font-medium">Batchmaker</th>
                <th className="text-center px-4 py-3 font-medium">Verpakking</th>
                <th className="text-center px-4 py-3 font-medium">Floriday</th>
                <th className="text-center px-4 py-3 font-medium">Raapmodule</th>
                <th className="text-center px-4 py-3 font-medium">Bestellijst</th>
                <th className="text-center px-4 py-3 font-medium">Admin</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr
                  key={profile.id}
                  className={`border-t border-border ${saving === profile.id ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3 text-sm font-medium">{profile.display_name}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{profile.email}</td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_batchmaker}
                      onChange={(v) => toggleField(profile.id, 'module_batchmaker', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_verpakkingsmodule}
                      onChange={(v) => toggleField(profile.id, 'module_verpakkingsmodule', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_floriday}
                      onChange={(v) => toggleField(profile.id, 'module_floriday', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_raapmodule}
                      onChange={(v) => toggleField(profile.id, 'module_raapmodule', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_bestellijst}
                      onChange={(v) => toggleField(profile.id, 'module_bestellijst', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.is_admin}
                      onChange={(v) => toggleField(profile.id, 'is_admin', v)}
                      disabled={profile.id === user?.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? 'bg-primary' : 'bg-gray-300'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
