'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuth, type UserProfile } from '@/components/providers/AuthProvider'
import { UserPlus, Trash2, KeyRound, Copy, Check, Loader2 } from 'lucide-react'
import Dialog from '@/components/ui/Dialog'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

export default function UserManagementClient() {
  const { user } = useAuth()
  const [profiles, setProfiles] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null)
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null)

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

  const handleDelete = async () => {
    if (!deleteTarget) return
    const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: 'DELETE' })
    if (res.ok) {
      setProfiles(prev => prev.filter(p => p.id !== deleteTarget.id))
    }
    setDeleteTarget(null)
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
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold">Gebruikersbeheer</h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Account aanmaken
          </button>
        </div>

        <div className="border border-border rounded-lg overflow-x-auto">
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
                <th className="text-center px-4 py-3 font-medium">Incidenten</th>
                <th className="text-center px-4 py-3 font-medium">Finance</th>
                <th className="text-center px-4 py-3 font-medium">Admin</th>
                <th className="text-center px-4 py-3 font-medium w-16"></th>
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
                      checked={profile.module_incidenten}
                      onChange={(v) => toggleField(profile.id, 'module_incidenten', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.module_finance}
                      onChange={(v) => toggleField(profile.id, 'module_finance', v)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Toggle
                      checked={profile.is_admin}
                      onChange={(v) => toggleField(profile.id, 'is_admin', v)}
                      disabled={profile.id === user?.id}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setResetTarget(profile)}
                        className="p-1.5 rounded-md hover:bg-amber-50 transition-colors text-muted-foreground hover:text-amber-600"
                        title="Wachtwoord resetten"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      {profile.id !== user?.id && (
                        <button
                          onClick={() => setDeleteTarget(profile)}
                          className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                          title="Verwijderen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Dialog */}
      <CreateUserDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={fetchProfiles}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Gebruiker verwijderen"
        message={`Weet je zeker dat je ${deleteTarget?.display_name} (${deleteTarget?.email}) wilt verwijderen? Dit kan niet ongedaan worden.`}
        confirmText="Verwijderen"
        variant="destructive"
      />

      {/* Reset Password Dialog */}
      <ResetPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
      />
    </div>
  )
}

// ─── Create User Dialog ─────────────────────────────────────────────────────

function CreateUserDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ email: string; temporary_password: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    const res = await fetch('/api/admin/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, display_name: displayName }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error)
      return
    }

    setResult({ email: data.email, temporary_password: data.temporary_password })
    onSuccess()
  }

  const handleClose = () => {
    setEmail('')
    setDisplayName('')
    setError('')
    setResult(null)
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Account aanmaken">
      <div className="p-4">
        {result ? (
          <div className="space-y-3">
            <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-sm">
              Account aangemaakt voor <strong>{result.email}</strong>
            </div>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">E-mailadres</p>
                <CopyField value={result.email} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tijdelijk wachtwoord</p>
                <CopyField value={result.temporary_password} />
              </div>
            </div>
            <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm">
              Deel deze gegevens veilig met de gebruiker. Het wachtwoord wordt niet opnieuw getoond.
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
              >
                Sluiten
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Naam</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Volledige naam"
                className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-sm"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">E-mailadres</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="naam@bedrijf.com"
                className="w-full px-3 py-2 border border-border rounded-md focus:ring-2 focus:ring-primary/50 focus:border-primary outline-none text-sm"
                required
              />
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={loading || !email || !displayName}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Aanmaken
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  )
}

// ─── Reset Password Dialog ──────────────────────────────────────────────────

function ResetPasswordDialog({
  target,
  onClose,
}: {
  target: UserProfile | null
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ email: string; temporary_password: string } | null>(null)

  const handleReset = async () => {
    if (!target) return
    setError('')
    setLoading(true)

    const res = await fetch(`/api/admin/users/${target.id}/reset-password`, {
      method: 'POST',
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error)
      return
    }

    setResult({ email: data.email, temporary_password: data.temporary_password })
  }

  const handleClose = () => {
    setError('')
    setResult(null)
    onClose()
  }

  return (
    <Dialog open={!!target} onClose={handleClose} title="Wachtwoord resetten">
      <div className="p-4">
        {result ? (
          <div className="space-y-3">
            <div className="bg-emerald-50 text-emerald-800 p-3 rounded-lg text-sm">
              Wachtwoord gereset voor <strong>{result.email}</strong>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Tijdelijk wachtwoord</p>
              <CopyField value={result.temporary_password} />
            </div>
            <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm">
              Deel dit wachtwoord veilig met de gebruiker. Het wordt niet opnieuw getoond.
            </div>
            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
              >
                Sluiten
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Weet je zeker dat je het wachtwoord van <strong>{target?.display_name}</strong> ({target?.email}) wilt resetten? Er wordt een nieuw tijdelijk wachtwoord gegenereerd.
            </p>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
              >
                Annuleren
              </button>
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-md hover:bg-amber-600 transition-colors disabled:opacity-50"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Wachtwoord resetten
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ─── Shared Components ──────────────────────────────────────────────────────

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
      <code className="text-sm flex-1 truncate">{value}</code>
      <button
        onClick={handleCopy}
        className="shrink-0 p-1 rounded hover:bg-background transition-colors"
        title="Kopiëren"
      >
        {copied ? (
          <Check className="w-4 h-4 text-emerald-600" />
        ) : (
          <Copy className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
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
