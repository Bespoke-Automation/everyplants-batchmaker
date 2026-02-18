'use client'

import { useState, useRef } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  Plus,
  Package,
  Pencil,
  Trash2,
  X,
  Save,
  Check,
  Upload,
  ImageIcon,
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
  picqerTagName: string
  numShippingLabels: string
  // Skip Picqer
  skipPicqer: boolean
  manualIdpackaging: string
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
  picqerTagName: '',
  numShippingLabels: '1',
  skipPicqer: false,
  manualIdpackaging: '',
}

const BOX_CATEGORIES = ['compartment', 'single', 'multi', 'save_me', 'fold', 'sale'] as const

export default function PackagingList() {
  const {
    packagings,
    isLoading,
    error,
    isSyncing,
    syncFromPicqer,
    createPackaging,
    updatePackaging,
    deletePackaging,
    refresh,
  } = useLocalPackagings()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formData, setFormData] = useState<PackagingFormData>(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [createResult, setCreateResult] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmDeletePkg, setConfirmDeletePkg] = useState<LocalPackaging | null>(null)
  const [deleteResult, setDeleteResult] = useState<string | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSync = async () => {
    setSyncResult(null)
    try {
      const result = await syncFromPicqer()
      setSyncResult(`${result.synced} verpakkingen gesynchroniseerd (${result.added} nieuw, ${result.updated} bijgewerkt)`)
    } catch {
      // Error is set by the hook
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setFormError('Selecteer een afbeelding (JPG, PNG, etc.)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFormError('Afbeelding is te groot (max 5MB)')
      return
    }

    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  const uploadImage = async (idpackaging: number): Promise<string | null> => {
    if (!imageFile) return null

    setIsUploadingImage(true)
    try {
      const formData = new FormData()
      formData.append('file', imageFile)
      formData.append('idpackaging', String(idpackaging))

      const response = await fetch('/api/verpakking/packagings/upload-image', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Upload mislukt')
      }
      const data = await response.json()
      return data.imageUrl as string
    } catch (err) {
      console.error('Image upload failed:', err)
      setFormError(err instanceof Error ? err.message : 'Afbeelding upload mislukt')
      return null
    } finally {
      setIsUploadingImage(false)
    }
  }

  const removeImage = async (idpackaging: number) => {
    try {
      await fetch('/api/verpakking/packagings/upload-image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idpackaging }),
      })
    } catch {
      // best effort
    }
    setImageFile(null)
    setImagePreview(null)
  }

  const handleDelete = async () => {
    if (!confirmDeletePkg) return

    setDeletingId(confirmDeletePkg.idpackaging)
    setDeleteResult(null)

    try {
      const result = await deletePackaging(confirmDeletePkg.idpackaging)
      const parts: string[] = [`Verpakking "${confirmDeletePkg.name}" verwijderd.`]
      if (result.deletedTagTitle) {
        parts.push(`Tag "${result.deletedTagTitle}" verwijderd uit Picqer.`)
      }
      if (result.warnings?.length) {
        parts.push(result.warnings.join(' '))
      }
      setDeleteResult(parts.join(' '))
    } catch {
      // Error is set by the hook
    } finally {
      setDeletingId(null)
      setConfirmDeletePkg(null)
    }
  }

  const openCreateForm = () => {
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
    setCreateResult(null)
    setImageFile(null)
    setImagePreview(null)
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
      picqerTagName: pkg.picqerTagName || '',
      numShippingLabels: pkg.numShippingLabels.toString(),
      skipPicqer: false,
      manualIdpackaging: pkg.idpackaging > 0 ? pkg.idpackaging.toString() : '',
    })
    setFormError(null)
    setCreateResult(null)
    setImageFile(null)
    setImagePreview(pkg.imageUrl || null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
    setImageFile(null)
    setImagePreview(null)
  }

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      setFormError('Naam is verplicht')
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      if (editingId) {
        const payload: Record<string, unknown> = {
          name: formData.name.trim(),
          barcode: formData.barcode.trim() || undefined,
          length: formData.length ? parseInt(formData.length, 10) : undefined,
          width: formData.width ? parseInt(formData.width, 10) : undefined,
          height: formData.height ? parseInt(formData.height, 10) : undefined,
          max_weight: formData.maxWeight ? parseInt(formData.maxWeight, 10) : null,
          box_category: formData.boxCategory || null,
          specificity_score: formData.specificityScore ? parseInt(formData.specificityScore, 10) : 50,
          handling_cost: formData.handlingCost ? parseFloat(formData.handlingCost) : 0,
          material_cost: formData.materialCost ? parseFloat(formData.materialCost) : 0,
          use_in_auto_advice: formData.useInAutoAdvice,
          picqer_tag_name: formData.picqerTagName.trim() || null,
          num_shipping_labels: formData.numShippingLabels ? parseInt(formData.numShippingLabels, 10) : 1,
        }
        // Include new_idpackaging if changed
        const newId = formData.manualIdpackaging ? parseInt(formData.manualIdpackaging, 10) : null
        if (newId && newId !== editingId) {
          payload.new_idpackaging = newId
        }
        await updatePackaging(editingId, payload as Parameters<typeof updatePackaging>[1])

        // Upload image if a new file was selected
        if (imageFile) {
          await uploadImage(newId && newId !== editingId ? newId : editingId)
          await refresh()
        }

        closeForm()
      } else {
        const createPayload: Record<string, unknown> = {
          name: formData.name.trim(),
          barcode: formData.barcode.trim() || undefined,
          length: formData.length ? parseInt(formData.length, 10) : undefined,
          width: formData.width ? parseInt(formData.width, 10) : undefined,
          height: formData.height ? parseInt(formData.height, 10) : undefined,
        }

        if (formData.skipPicqer) {
          createPayload.skipPicqer = true
          if (formData.manualIdpackaging) {
            createPayload.idpackaging = parseInt(formData.manualIdpackaging, 10)
          }
        }

        const result = await createPackaging(createPayload as Parameters<typeof createPackaging>[0])

        // Upload image if a file was selected
        if (imageFile && result.packaging?.idpackaging) {
          await uploadImage(result.packaging.idpackaging)
          await refresh()
        }

        if (result.skippedPicqer) {
          setCreateResult(
            `Verpakking "${result.packaging.name}" lokaal aangemaakt (zonder Picqer).`
          )
        } else {
          setCreateResult(
            `Verpakking "${result.packaging.name}" aangemaakt. Tag "${result.tag.title}" automatisch aangemaakt en gekoppeld.`
          )
        }
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

      {/* Delete result */}
      {deleteResult && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
          <Trash2 className="w-4 h-4 shrink-0" />
          {deleteResult}
        </div>
      )}

      {/* Confirm delete dialog */}
      {confirmDeletePkg && (
        <div className="mb-4 p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
          <p className="text-sm font-medium mb-1">
            Verpakking &quot;{confirmDeletePkg.name}&quot; verwijderen?
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            De bijhorende tag wordt verwijderd uit Picqer en de verpakking wordt gedeactiveerd in Picqer. Deze actie kan niet ongedaan worden gemaakt.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDelete}
              disabled={deletingId !== null}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-destructive text-destructive-foreground rounded-lg font-medium hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {deletingId ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Verwijderen
            </button>
            <button
              onClick={() => setConfirmDeletePkg(null)}
              disabled={deletingId !== null}
              className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              Annuleren
            </button>
          </div>
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

          {/* Section: Foto */}
          <div className="mb-5">
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Foto</h4>
            <div className="flex items-start gap-4">
              {imagePreview ? (
                <div className="relative group">
                  <img
                    src={imagePreview}
                    alt="Verpakking"
                    className="w-24 h-24 rounded-lg object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (editingId && !imageFile) {
                        // Remove existing image from server
                        removeImage(editingId)
                      } else {
                        setImageFile(null)
                        setImagePreview(null)
                      }
                    }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Foto verwijderen"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                >
                  <Upload className="w-5 h-5" />
                  <span className="text-[10px]">Upload</span>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              {imagePreview && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-primary hover:underline mt-1"
                >
                  Andere foto kiezen
                </button>
              )}
              {isUploadingImage && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Uploaden...
                </div>
              )}
            </div>
          </div>

          {/* Section: Picqer koppeling */}
          {editingId && (
            <div className="mb-5">
              <div>
                <label className="block text-sm font-medium mb-1">Picqer Packaging ID</label>
                <input
                  type="number"
                  value={formData.manualIdpackaging}
                  onChange={(e) => setFormData((prev) => ({ ...prev, manualIdpackaging: e.target.value }))}
                  placeholder="Bijv. 2100"
                  className="w-48 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Het Picqer packaging ID. Wijzig alleen als je de koppeling wil aanpassen.
                </p>
              </div>
            </div>
          )}

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

                <div>
                  <label className="block text-sm font-medium mb-1">Picqer tag naam</label>
                  <input
                    type="text"
                    value={formData.picqerTagName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, picqerTagName: e.target.value }))}
                    placeholder="Bijv. 10. Fold box 100"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Naam van de Picqer tag die geschreven wordt op orders (bijv. &quot;10. Fold box 100&quot;).
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Aantal verzendlabels</label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={formData.numShippingLabels}
                    onChange={(e) => setFormData((prev) => ({ ...prev, numShippingLabels: e.target.value }))}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Hoeveel verzendlabels er aangemaakt worden voor deze doos.
                  </p>
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
            <div className="mt-4 pt-4 border-t border-border">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={formData.skipPicqer}
                    onChange={(e) => setFormData((prev) => ({ ...prev, skipPicqer: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </div>
                <span className="text-sm font-medium">Niet aanmaken in Picqer</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1 ml-12">
                {formData.skipPicqer
                  ? 'Alleen lokaal opslaan. Je kan het Picqer Packaging ID later nog invullen via bewerken.'
                  : 'Bij aanmaken wordt automatisch een bijpassende tag en verpakking aangemaakt in Picqer.'}
              </p>

              {formData.skipPicqer && (
                <div className="mt-3 ml-12">
                  <label className="block text-sm font-medium mb-1">Picqer Packaging ID</label>
                  <input
                    type="number"
                    value={formData.manualIdpackaging}
                    onChange={(e) => setFormData((prev) => ({ ...prev, manualIdpackaging: e.target.value }))}
                    placeholder="Bijv. 2100"
                    className="w-48 px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                  />
                </div>
              )}
            </div>
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
                <th className="text-left px-3 py-3 font-medium">Picqer tag</th>
                <th className="text-right px-3 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Afmetingen</th>
                <th className="text-right px-3 py-3 font-medium">Max (g)</th>
                <th className="text-center px-3 py-3 font-medium">Labels</th>
                <th className="text-center px-3 py-3 font-medium">Advies</th>
                <th className="text-center px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {packagings.map((pkg) => (
                <tr key={pkg.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {pkg.imageUrl ? (
                        <img
                          src={pkg.imageUrl}
                          alt={pkg.name}
                          className="w-8 h-8 rounded object-cover flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                          <ImageIcon className="w-4 h-4 text-muted-foreground" />
                        </div>
                      )}
                      {pkg.name}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {pkg.picqerTagName ? (
                      <span className="text-xs font-mono text-muted-foreground">{pkg.picqerTagName}</span>
                    ) : (
                      <span className="text-xs text-amber-500">Niet ingesteld</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {pkg.idpackaging > 0 ? (
                      <span className="text-muted-foreground">{pkg.idpackaging}</span>
                    ) : (
                      <span className="text-amber-500 text-xs font-medium">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {pkg.length && pkg.width && pkg.height
                      ? `${pkg.length}×${pkg.width}×${pkg.height}`
                      : '-'}
                  </td>
                  <td className="px-3 py-3 text-right text-muted-foreground text-xs">
                    {pkg.maxWeight != null ? pkg.maxWeight.toLocaleString('nl-NL') : '-'}
                  </td>
                  <td className="px-3 py-3 text-center text-muted-foreground text-xs">
                    {pkg.numShippingLabels ?? 1}
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
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEditForm(pkg)}
                        className="p-2 rounded-lg hover:bg-muted transition-colors"
                        title="Bewerken"
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => {
                          setDeleteResult(null)
                          setConfirmDeletePkg(pkg)
                        }}
                        disabled={deletingId !== null}
                        className="p-2 rounded-lg hover:bg-destructive/10 transition-colors disabled:opacity-50"
                        title="Verwijderen"
                      >
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
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
