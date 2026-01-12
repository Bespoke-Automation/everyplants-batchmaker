'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { usePostalRegions } from '@/hooks/usePostalRegions'
import { PostalRegion, PostalRange, PostalRegionInsert } from '@/lib/supabase/postalRegions'
import ConfirmDialog from '@/components/ui/ConfirmDialog'

interface RegionFormData {
  region_id: string
  name: string
  countries: string
  postal_ranges: PostalRange[]
  sort_order: number
}

const AVAILABLE_COUNTRIES = [
  { code: 'NL', name: 'Nederland' },
  { code: 'BE', name: 'Belgie' },
  { code: 'DE', name: 'Duitsland' },
  { code: 'FR', name: 'Frankrijk' },
  { code: 'AT', name: 'Oostenrijk' },
  { code: 'LU', name: 'Luxemburg' },
  { code: 'ES', name: 'Spanje' },
  { code: 'IT', name: 'Italie' },
  { code: 'SE', name: 'Zweden' },
]

function PostalRangeEditor({
  ranges,
  countries,
  onChange,
}: {
  ranges: PostalRange[]
  countries: string[]
  onChange: (ranges: PostalRange[]) => void
}) {
  const addRange = () => {
    onChange([...ranges, { country: countries[0] || 'DE', from: '', to: '' }])
  }

  const updateRange = (index: number, field: keyof PostalRange, value: string) => {
    const newRanges = [...ranges]
    newRanges[index] = { ...newRanges[index], [field]: value }
    onChange(newRanges)
  }

  const removeRange = (index: number) => {
    onChange(ranges.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-muted-foreground uppercase block">
        Postcode Ranges (leeg = alle postcodes in geselecteerde landen)
      </label>
      {ranges.map((range, index) => (
        <div key={index} className="flex gap-2 items-center">
          <select
            value={range.country}
            onChange={(e) => updateRange(index, 'country', e.target.value)}
            className="h-9 px-2 rounded-md border border-input bg-background text-sm"
          >
            {countries.map(code => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Van"
            value={range.from}
            onChange={(e) => updateRange(index, 'from', e.target.value)}
            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
          <span className="text-muted-foreground">-</span>
          <input
            type="text"
            placeholder="Tot"
            value={range.to}
            onChange={(e) => updateRange(index, 'to', e.target.value)}
            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
          <button
            type="button"
            onClick={() => removeRange(index)}
            className="p-2 text-destructive hover:bg-destructive/10 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRange}
        disabled={countries.length === 0}
        className="text-sm text-primary hover:underline disabled:opacity-50"
      >
        + Range toevoegen
      </button>
    </div>
  )
}

function RegionForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
}: {
  initialData?: PostalRegion
  onSubmit: (data: PostalRegionInsert) => Promise<void>
  onCancel: () => void
  isLoading: boolean
}) {
  const [formData, setFormData] = useState<RegionFormData>({
    region_id: initialData?.region_id || '',
    name: initialData?.name || '',
    countries: initialData?.countries?.join(', ') || '',
    postal_ranges: initialData?.postal_ranges || [],
    sort_order: initialData?.sort_order || 0,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const countries = formData.countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)
    await onSubmit({
      region_id: formData.region_id.toLowerCase().replace(/\s+/g, '-'),
      name: formData.name,
      countries,
      postal_ranges: formData.postal_ranges,
      sort_order: formData.sort_order,
    })
  }

  const countries = formData.countries.split(',').map(c => c.trim().toUpperCase()).filter(Boolean)

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-card border border-border rounded-lg">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
            Regio ID
          </label>
          <input
            type="text"
            value={formData.region_id}
            onChange={(e) => setFormData(prev => ({ ...prev, region_id: e.target.value }))}
            placeholder="west-germany"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            required
            disabled={!!initialData}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
            Naam
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="West Duitsland"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
            Landen (komma-gescheiden)
          </label>
          <input
            type="text"
            value={formData.countries}
            onChange={(e) => setFormData(prev => ({ ...prev, countries: e.target.value }))}
            placeholder="DE, NL, BE"
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Beschikbaar: {AVAILABLE_COUNTRIES.map(c => c.code).join(', ')}
          </p>
        </div>
        <div>
          <label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
            Sorteervolgorde
          </label>
          <input
            type="number"
            value={formData.sort_order}
            onChange={(e) => setFormData(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
      </div>

      <PostalRangeEditor
        ranges={formData.postal_ranges}
        countries={countries}
        onChange={(ranges) => setFormData(prev => ({ ...prev, postal_ranges: ranges }))}
      />

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
          disabled={isLoading}
        >
          Annuleren
        </button>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          disabled={isLoading}
        >
          {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
          {initialData ? 'Opslaan' : 'Toevoegen'}
        </button>
      </div>
    </form>
  )
}

function RegionCard({
  region,
  onEdit,
  onDelete,
}: {
  region: PostalRegion
  onEdit: () => void
  onDelete: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 hover:bg-muted rounded"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div>
            <h3 className="font-semibold">{region.name}</h3>
            <p className="text-sm text-muted-foreground">
              {region.countries.join(', ')} - {region.postal_ranges?.length || 0} ranges
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{region.sort_order}</span>
          <button
            onClick={onEdit}
            className="p-2 hover:bg-muted rounded-md transition-colors"
            title="Bewerken"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-2 hover:bg-destructive/10 text-destructive rounded-md transition-colors"
            title="Verwijderen"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {isExpanded && region.postal_ranges && region.postal_ranges.length > 0 && (
        <div className="px-4 pb-4 pt-0">
          <div className="bg-muted/50 rounded-md p-3">
            <p className="text-xs font-bold text-muted-foreground uppercase mb-2">Postcode Ranges</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {region.postal_ranges.map((range, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium">{range.country}:</span> {range.from} - {range.to}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PostalRegionsManager() {
  const { regions, isLoading, addRegion, editRegion, removeRegion, refetch } = usePostalRegions({ includeInactive: true })
  const [isAddingNew, setIsAddingNew] = useState(false)
  const [editingRegion, setEditingRegion] = useState<PostalRegion | null>(null)
  const [deletingRegion, setDeletingRegion] = useState<PostalRegion | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleAdd = async (data: PostalRegionInsert) => {
    setIsSubmitting(true)
    try {
      await addRegion(data)
      setIsAddingNew(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = async (data: PostalRegionInsert) => {
    if (!editingRegion) return
    setIsSubmitting(true)
    try {
      await editRegion(editingRegion.id, {
        name: data.name,
        countries: data.countries,
        postal_ranges: data.postal_ranges,
        sort_order: data.sort_order,
      })
      setEditingRegion(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingRegion) return
    setIsSubmitting(true)
    try {
      await removeRegion(deletingRegion.id)
      setDeletingRegion(null)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Postcode Regios</h2>
          <p className="text-sm text-muted-foreground">
            Beheer de regios voor het filteren van orders op postcode.
          </p>
        </div>
        {!isAddingNew && !editingRegion && (
          <button
            onClick={() => setIsAddingNew(true)}
            className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-white hover:bg-primary/90 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nieuwe regio
          </button>
        )}
      </div>

      {isAddingNew && (
        <RegionForm
          onSubmit={handleAdd}
          onCancel={() => setIsAddingNew(false)}
          isLoading={isSubmitting}
        />
      )}

      {editingRegion && (
        <RegionForm
          initialData={editingRegion}
          onSubmit={handleEdit}
          onCancel={() => setEditingRegion(null)}
          isLoading={isSubmitting}
        />
      )}

      <div className="space-y-2">
        {regions.map(region => (
          <RegionCard
            key={region.id}
            region={region}
            onEdit={() => setEditingRegion(region)}
            onDelete={() => setDeletingRegion(region)}
          />
        ))}
      </div>

      {regions.length === 0 && !isAddingNew && (
        <div className="text-center py-10 text-muted-foreground">
          Geen regios gevonden. Voeg een nieuwe regio toe.
        </div>
      )}

      <ConfirmDialog
        open={!!deletingRegion}
        onClose={() => setDeletingRegion(null)}
        onConfirm={handleDelete}
        title="Regio verwijderen"
        message={`Weet je zeker dat je "${deletingRegion?.name}" wilt verwijderen?`}
        confirmText="Verwijderen"
        cancelText="Annuleren"
        variant="destructive"
        isLoading={isSubmitting}
      />
    </div>
  )
}
