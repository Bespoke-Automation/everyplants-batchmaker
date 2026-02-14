'use client'

import { useState } from 'react'
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  RefreshCw,
  X,
  Check,
  Save,
} from 'lucide-react'
import { useTagMappings } from '@/hooks/useTagMappings'
import { useLocalTags } from '@/hooks/useLocalTags'
import { useLocalPackagings } from '@/hooks/useLocalPackagings'
import type { TagPackagingMapping } from '@/types/verpakking'

interface MappingFormData {
  tagTitle: string
  idtag: number | null
  picqerPackagingId: number | null
  packagingName: string
  isActive: boolean
}

const emptyFormData: MappingFormData = {
  tagTitle: '',
  idtag: null,
  picqerPackagingId: null,
  packagingName: '',
  isActive: true,
}

export default function TagMappingSettings() {
  const {
    mappings,
    isLoading,
    error,
    addMapping,
    updateMapping,
    removeMapping,
    refresh,
  } = useTagMappings()

  const {
    tags: allTags,
    isLoading: tagsLoading,
  } = useLocalTags()

  const {
    packagings: localPackagings,
    isLoading: packagingsLoading,
  } = useLocalPackagings(true)

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<MappingFormData>(emptyFormData)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const openAddForm = () => {
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
    setShowForm(true)
  }

  const openEditForm = (mapping: TagPackagingMapping) => {
    setEditingId(mapping.id)
    setFormData({
      tagTitle: mapping.tagTitle,
      idtag: null, // We don't have this in the mapping yet
      picqerPackagingId: mapping.picqerPackagingId,
      packagingName: mapping.packagingName,
      isActive: mapping.isActive,
    })
    setFormError(null)
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(emptyFormData)
    setFormError(null)
  }

  const handleTagChange = (idtagStr: string) => {
    const idtag = Number(idtagStr)
    const tag = allTags.find((t) => t.idtag === idtag)
    setFormData((prev) => ({
      ...prev,
      tagTitle: tag?.title ?? '',
      idtag: idtag || null,
    }))
  }

  const handlePackagingChange = (packagingId: string) => {
    const id = Number(packagingId)
    const packaging = localPackagings.find((p) => p.idpackaging === id)
    setFormData((prev) => ({
      ...prev,
      picqerPackagingId: id,
      packagingName: packaging?.name ?? '',
    }))
  }

  const handleSubmit = async () => {
    if (!formData.tagTitle.trim()) {
      setFormError('Selecteer een tag')
      return
    }
    if (!formData.picqerPackagingId) {
      setFormError('Selecteer een verpakking')
      return
    }

    setIsSaving(true)
    setFormError(null)

    try {
      if (editingId) {
        await updateMapping(editingId, {
          tagTitle: formData.tagTitle.trim(),
          picqerPackagingId: formData.picqerPackagingId,
          packagingName: formData.packagingName,
          isActive: formData.isActive,
        })
      } else {
        await addMapping({
          tagTitle: formData.tagTitle.trim(),
          picqerPackagingId: formData.picqerPackagingId,
          packagingName: formData.packagingName,
          isActive: formData.isActive,
        })
      }
      closeForm()
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Fout bij opslaan'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await removeMapping(id)
      setDeleteConfirmId(null)
    } catch {
      // Error is set by the hook
    }
  }

  // Filter out tags/packagings that already have a mapping (except the one being edited)
  const mappedTagTitles = new Set(
    mappings
      .filter((m) => m.id !== editingId)
      .map((m) => m.tagTitle.toLowerCase())
  )
  const mappedPackagingIds = new Set(
    mappings
      .filter((m) => m.id !== editingId)
      .map((m) => m.picqerPackagingId)
  )
  const availableTags = allTags.filter(
    (t) => !mappedTagTitles.has(t.title.toLowerCase())
  )
  const availablePackagings = localPackagings.filter(
    (p) => !mappedPackagingIds.has(p.idpackaging)
  )

  const noTagsOrPackagings = allTags.length === 0 || localPackagings.length === 0

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-lg text-muted-foreground">Koppelingen laden...</p>
      </div>
    )
  }

  // Error state
  if (error && mappings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2">Fout bij laden</h2>
            <p className="text-muted-foreground">{error.message}</p>
          </div>
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium text-base hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            Opnieuw proberen
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Tag → Verpakking Koppelingen</h2>
            <p className="text-sm text-muted-foreground">
              Configureer welke Picqer tags aan welke verpakking worden gekoppeld
            </p>
          </div>
        </div>
        <button
          onClick={refresh}
          className="p-2 rounded-lg hover:bg-muted transition-colors"
          title="Vernieuwen"
        >
          <RefreshCw className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Warning: no data */}
      {noTagsOrPackagings && !tagsLoading && !packagingsLoading && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Synchroniseer eerst tags en verpakkingen via de Tags- en Verpakkingen-tabbladen.
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error.message}
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button
          onClick={openAddForm}
          className="w-full mb-4 flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nieuwe koppeling
        </button>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="mb-4 p-4 bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">
              {editingId ? 'Koppeling bewerken' : 'Nieuwe koppeling'}
            </h3>
            <button
              onClick={closeForm}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tag dropdown */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Tag (verpakking)
              </label>
              {tagsLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Laden...
                </div>
              ) : availableTags.length === 0 ? (
                <p className="text-sm text-amber-600">
                  {allTags.length === 0
                    ? 'Geen tags gevonden. Synchroniseer eerst via het Tags-tabblad.'
                    : 'Alle tags zijn al gekoppeld.'}
                </p>
              ) : (
                <select
                  value={
                    formData.idtag
                      ? formData.idtag.toString()
                      : availableTags.find((t) => t.title === formData.tagTitle)?.idtag?.toString() ?? ''
                  }
                  onChange={(e) => handleTagChange(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                >
                  <option value="">Selecteer tag...</option>
                  {availableTags.map((tag) => (
                    <option key={tag.idtag} value={tag.idtag}>
                      {tag.title}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Packaging dropdown */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Verpakking
              </label>
              {packagingsLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Laden...
                </div>
              ) : availablePackagings.length === 0 ? (
                <p className="text-sm text-amber-600">
                  {localPackagings.length === 0
                    ? 'Geen verpakkingen. Synchroniseer via het Verpakkingen-tabblad.'
                    : 'Alle verpakkingen zijn al gekoppeld.'}
                </p>
              ) : (
                <select
                  value={formData.picqerPackagingId ?? ''}
                  onChange={(e) => handlePackagingChange(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                >
                  <option value="">Selecteer verpakking...</option>
                  {availablePackagings.map((p) => (
                    <option key={p.idpackaging} value={p.idpackaging}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3 pt-6">
              <button
                type="button"
                onClick={() =>
                  setFormData((prev) => ({ ...prev, isActive: !prev.isActive }))
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  formData.isActive ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    formData.isActive ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm font-medium">
                {formData.isActive ? 'Actief' : 'Inactief'}
              </span>
            </div>
          </div>

          {/* Form error */}
          {formError && (
            <div className="mt-3 p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {formError}
            </div>
          )}

          {/* Form actions */}
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
              {editingId ? 'Opslaan' : 'Toevoegen'}
            </button>
          </div>
        </div>
      )}

      {/* Mappings list */}
      {mappings.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Settings className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Geen koppelingen</h3>
          <p className="text-sm text-muted-foreground">
            Voeg een tag → verpakking koppeling toe om te beginnen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mappings.map((mapping) => {
              // Find the tag color from local tags
              const tagInfo = allTags.find(
                (t) => t.title.toLowerCase() === mapping.tagTitle.toLowerCase()
              )

              return (
                <div
                  key={mapping.id}
                  className={`p-4 bg-card border rounded-lg flex items-center justify-between gap-4 ${
                    mapping.isActive ? 'border-border' : 'border-border opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-sm font-medium bg-primary/10 text-primary">
                        {tagInfo && (
                          <span
                            className="w-3 h-3 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: tagInfo.color || '#ccc' }}
                          />
                        )}
                        {mapping.tagTitle}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-medium text-sm truncate">
                        {mapping.packagingName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>Packaging ID: {mapping.picqerPackagingId}</span>
                      <span
                        className={`inline-flex items-center gap-1 ${
                          mapping.isActive ? 'text-emerald-600' : 'text-muted-foreground'
                        }`}
                      >
                        {mapping.isActive ? (
                          <>
                            <Check className="w-3 h-3" /> Actief
                          </>
                        ) : (
                          <>
                            <X className="w-3 h-3" /> Inactief
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {deleteConfirmId === mapping.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-destructive mr-1">
                          Verwijderen?
                        </span>
                        <button
                          onClick={() => handleDelete(mapping.id)}
                          className="p-2 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                          title="Bevestig verwijdering"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(null)}
                          className="p-2 rounded-lg hover:bg-muted transition-colors"
                          title="Annuleren"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => openEditForm(mapping)}
                          className="p-2 rounded-lg hover:bg-muted transition-colors"
                          title="Bewerken"
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(mapping.id)}
                          className="p-2 rounded-lg hover:bg-destructive/10 transition-colors"
                          title="Verwijderen"
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
