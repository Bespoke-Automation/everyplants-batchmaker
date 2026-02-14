'use client'

import { useState } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Plus,
  Package,
  Pencil,
  X,
  Save,
  Check,
} from 'lucide-react'
import { useLocalPackagings } from '@/hooks/useLocalPackagings'
import type { LocalPackaging } from '@/types/verpakking'

interface PackagingFormData {
  name: string
  barcode: string
  length: string
  width: string
  height: string
  // Engine fields
  maxWeight: string
  boxCategory: string
  specificityScore: string
  handlingCost: string
  materialCost: string
  useInAutoAdvice: boolean
}

const emptyFormData: PackagingFormData = {
  name: '',
  barcode: '',
  length: '',
  width: '',
  height: '',
  maxWeight: '',
  boxCategory: '',
  specificityScore: '50',
  handlingCost: '0',
  materialCost: '0',
  useInAutoAdvice: false,
}

const BOX_CATEGORIES = ['single', 'multi', 'save_me', 'fold', 'sale'] as const

export default function PackagingList() {
  const {
    packagings,
    isLoading,
    error,
    isSyncing,
    syncFromPicqer,
    createPackaging,
    updatePackaging,
  } = useLocalPackagings()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState<PackagingFormData>(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<string | null>(null)

  const handleSync = async () => {
    setSyncResult(null)
    try {
      const result = await syncFromPicqer()
      setSyncResult(`${result.synced} verpakkingen gesynchroniseerd (${result.added} nieuw, ${result.updated} bijgewerkt)`)
    } catch {
      // Error is set by the hook
    }
  }

  const openCreateForm = () => {
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
    setCreateResult(null)
    setShowForm(true)
  }

  const openEditForm = (pkg: LocalPackaging) => {
    setEditingId(pkg.idpackaging)
    setFormData({
      name: pkg.name,
      barcode: pkg.barcode || '',
      length: pkg.length?.toString() || '',
      width: pkg.width?.toString() || '',
      height: pkg.height?.toString() || '',
      maxWeight: pkg.maxWeight?.toString() || '',
      boxCategory: pkg.boxCategory || '',
      specificityScore: pkg.specificityScore.toString(),
      handlingCost: pkg.handlingCost.toString(),
      materialCost: pkg.materialCost.toString(),
      useInAutoAdvice: pkg.useInAutoAdvice,
    })
    setFormError(null)
    setCreateResult(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
  }

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setFormError('Naam is verplicht')
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      const payload = {
        name: formData.name.trim(),
        barcode: formData.barcode.trim() || undefined,
        length: formData.length ? parseInt(formData.length, 10) : undefined,
        width: formData.width ? parseInt(formData.width, 10) : undefined,
        height: formData.height ? parseInt(formData.height, 10) : undefined,
        // Engine fields (snake_case for API)
        max_weight: formData.maxWeight ? parseInt(formData.maxWeight, 10) : null,
        box_category: formData.boxCategory || null,
        specificity_score: formData.specificityScore ? parseInt(formData.specificityScore, 10) : 50,
        handling_cost: formData.handlingCost ? parseFloat(formData.handlingCost) : 0,
        material_cost: formData.materialCost ? parseFloat(formData.materialCost) : 0,
        use_in_auto_advice: formData.useInAutoAdvice,
      }

      if (editingId) {
        await updatePackaging(editingId, payload)
        closeForm()
      } else {
        const result = await createPackaging(payload)
        setCreateResult(
          `Verpakking "${result.packaging.name}" aangemaakt. Tag "${result.tag.title}" automatisch aangemaakt en gekoppeld.`
        )
        closeForm()
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Fout bij opslaan')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Verpakkingen laden...</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Verpakkingen</h2>
            <p className="text-xs text-muted-foreground">
              {packagings.length} verpakkingen in database
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Synchroniseer
          </button>
          <button
            onClick={openCreateForm}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nieuwe verpakking
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-800">
          <RefreshCw className="w-4 h-4 shrink-0" />
          {syncResult}
        </div>
      )}

      {/* Create result */}
      {createResult && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-sm text-blue-800">
          <Check className="w-4 h-4 shrink-0" />
          {createResult}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="mb-4 p-4 bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">
              {editingId ? 'Verpakking bewerken' : 'Nieuwe verpakking'}
            </h3>
            <button onClick={closeForm} className="p-1 rounded hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Section: Basis */}
          <div className="mb-5">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Basis</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1">Naam *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Bijv. Verzenddoos Klein"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Barcode</label>
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => setFormData((prev) => ({ ...prev, barcode: e.target.value }))}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-sm font-medium mb-1">L (cm)</label>
                  <input
                    type="number"
                    value={formData.length}
                    onChange={(e) => setFormData((prev) => ({ ...prev, length: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">B (cm)</label>
                  <input
                    type="number"
                    value={formData.width}
                    onChange={(e) => setFormData((prev) => ({ ...prev, width: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">H (cm)</label>
                  <input
                    type="number"
                    value={formData.height}
                    onChange={(e) => setFormData((prev) => ({ ...prev, height: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section: Engine instellingen */}
          {editingId && (
            <div className="pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-muted-foreground mb-3">Engine instellingen</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Max gewicht (g)</label>
                  <input
                    type="number"
                    value={formData.maxWeight}
                    onChange={(e) => setFormData((prev) => ({ ...prev, maxWeight: e.target.value }))}
                    placeholder="Bijv. 5000"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Categorie</label>
                  <select
                    value={formData.boxCategory}
                    onChange={(e) => setFormData((prev) => ({ ...prev, boxCategory: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  >
                    <option value="">Geen categorie</option>
                    {BOX_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Specificiteit (1-100)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={formData.specificityScore}
                    onChange={(e) => setFormData((prev) => ({ ...prev, specificityScore: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">Materiaalkosten (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.materialCost}
                      onChange={(e) => setFormData((prev) => ({ ...prev, materialCost: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Afhandelkosten (EUR)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.handlingCost}
                      onChange={(e) => setFormData((prev) => ({ ...prev, handlingCost: e.target.value }))}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={formData.useInAutoAdvice}
                        onChange={(e) => setFormData((prev) => ({ ...prev, useInAutoAdvice: e.target.checked }))}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                    </div>
                    <span className="text-sm font-medium">Gebruik in auto-advies</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 ml-12">
                    Als actief wordt deze verpakking meegenomen in automatische verpakkingsadviezen.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!editingId && (
            <p className="text-xs text-muted-foreground mt-3">
              Bij aanmaken wordt automatisch een bijpassende tag aangemaakt in Picqer en een koppeling geconfigureerd.
              Engine instellingen kunnen daarna via bewerken worden ingesteld.
            </p>
          )}

          {formError && (
            <div className="mt-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              onClick={closeForm}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
              disabled={isSaving}
            >
              Annuleren
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {editingId ? 'Opslaan' : 'Aanmaken'}
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {packagings.length === 0 && !showForm ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Package className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Nog geen verpakkingen gesynchroniseerd</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Synchroniseer van Picqer of maak een nieuwe verpakking aan.
          </p>
        </div>
      ) : (
        /* Packaging table */
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-4 py-3 font-medium">Naam</th>
                <th className="text-left px-4 py-3 font-medium">Barcode</th>
                <th className="text-left px-4 py-3 font-medium">Afmetingen</th>
                <th className="text-right px-3 py-3 font-medium">Max (g)</th>
                <th className="text-left px-3 py-3 font-medium">Categorie</th>
                <th className="text-center px-3 py-3 font-medium">Advies</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {packagings.map((pkg) => (
                <tr key={pkg.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{pkg.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {pkg.barcode || '-'}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {pkg.length && pkg.width && pkg.height
                      ? `${pkg.length} x ${pkg.width} x ${pkg.height} cm`
                      : '-'}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground">
                    {pkg.maxWeight != null ? pkg.maxWeight.toLocaleString('nl-NL') : '-'}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {pkg.boxCategory || '-'}
                  </td>
                  <td className="px-3 py-3 text-center">
                    {pkg.useInAutoAdvice ? (
                      <span className="text-emerald-600 font-medium" title="Actief in auto-advies">&#10003;</span>
                    ) : (
                      <span className="text-gray-400" title="Niet in auto-advies">&#10007;</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        pkg.active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {pkg.active ? 'Actief' : 'Inactief'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEditForm(pkg)}
                      className="p-2 rounded-lg hover:bg-muted transition-colors"
                      title="Bewerken"
                    >
                      <Pencil className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
