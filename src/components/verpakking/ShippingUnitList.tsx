'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Loader2, AlertCircle, Package2, Search, Plus, Pencil, Trash2, X, AlertTriangle, Check } from 'lucide-react'
import { useTranslation } from '@/i18n/LanguageContext'

interface ShippingUnit {
  id: string
  name: string
  product_type: string
  sort_order: number
  is_active: boolean
  pot_size_min: number | null
  pot_size_max: number | null
  height_min: number | null
  height_max: number | null
  is_fragile_filter: boolean | null
  product_count: number
}

interface FormData {
  product_type: string
  pot_size_min: string
  pot_size_max: string
  height_min: string
  height_max: string
  is_fragile_filter: 'all' | 'true' | 'false'
  sort_order: string
}

const EMPTY_FORM: FormData = {
  product_type: '',
  pot_size_min: '',
  pot_size_max: '',
  height_min: '',
  height_max: '',
  is_fragile_filter: 'all',
  sort_order: '0',
}

function buildName(productType: string, form: FormData): string {
  const parts: string[] = []

  if (productType) {
    parts.push(productType.toUpperCase())
  }

  const potMin = form.pot_size_min ? parseFloat(form.pot_size_min) : null
  const potMax = form.pot_size_max ? parseFloat(form.pot_size_max) : null
  if (potMin !== null || potMax !== null) {
    if (potMin !== null && potMax !== null) {
      parts.push(`P${potMin}-P${potMax}`)
    } else if (potMin !== null) {
      parts.push(`P${potMin}+`)
    } else {
      parts.push(`≤P${potMax}`)
    }
  }

  const hMin = form.height_min ? parseFloat(form.height_min) : null
  const hMax = form.height_max ? parseFloat(form.height_max) : null
  if (hMin !== null || hMax !== null) {
    if (hMin !== null && hMax !== null) {
      parts.push(`H${hMin}-H${hMax}`)
    } else if (hMin !== null) {
      parts.push(`H${hMin}+`)
    } else {
      parts.push(`H0-H${hMax}`)
    }
  }

  if (form.is_fragile_filter === 'true') {
    parts.push('BREEKBAAR')
  }

  return parts.join(' | ') || ''
}

function rangesOverlap(
  aMin: number | null, aMax: number | null,
  bMin: number | null, bMax: number | null
): boolean {
  // If both ranges are completely open (null), they overlap
  const effectiveAMin = aMin ?? -Infinity
  const effectiveAMax = aMax ?? Infinity
  const effectiveBMin = bMin ?? -Infinity
  const effectiveBMax = bMax ?? Infinity
  return effectiveAMin <= effectiveBMax && effectiveBMin <= effectiveAMax
}

function fragileCompatible(a: boolean | null, b: boolean | null): boolean {
  if (a === null || b === null) return true
  return a === b
}

export default function ShippingUnitList() {
  const { t } = useTranslation()
  const [shippingUnits, setShippingUnits] = useState<ShippingUnit[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // CRUD state
  const [editingId, setEditingId] = useState<string | null>(null) // null = not editing, 'new' = creating
  const [form, setForm] = useState<FormData>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/verpakking/shipping-units')
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch shipping units')
      }
      const result = await response.json()
      setShippingUnits(result.shippingUnits || [])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Known product types from existing units
  const knownProductTypes = useMemo(() => {
    const types = new Set(shippingUnits.map(u => u.product_type))
    return Array.from(types).sort()
  }, [shippingUnits])

  // Overlap detection
  const overlaps = useMemo(() => {
    if (!editingId) return []

    const formPotMin = form.pot_size_min ? parseFloat(form.pot_size_min) : null
    const formPotMax = form.pot_size_max ? parseFloat(form.pot_size_max) : null
    const formHeightMin = form.height_min ? parseFloat(form.height_min) : null
    const formHeightMax = form.height_max ? parseFloat(form.height_max) : null
    const formFragile = form.is_fragile_filter === 'all' ? null : form.is_fragile_filter === 'true'

    if (!form.product_type) return []

    return shippingUnits.filter(u => {
      if (u.id === editingId) return false // skip self when editing
      if (u.product_type !== form.product_type) return false

      const potOverlap = rangesOverlap(formPotMin, formPotMax, u.pot_size_min, u.pot_size_max)
      const heightOverlap = rangesOverlap(formHeightMin, formHeightMax, u.height_min, u.height_max)
      const fragileOk = fragileCompatible(formFragile, u.is_fragile_filter)

      return potOverlap && heightOverlap && fragileOk
    })
  }, [editingId, form, shippingUnits])

  // Generated name preview
  const namePreview = useMemo(() => buildName(form.product_type, form) || t.settings.newShippingUnit, [form, t])

  // Filter by search query
  const filteredUnits = useMemo(() => {
    if (!searchQuery.trim()) return shippingUnits
    const query = searchQuery.toLowerCase()
    return shippingUnits.filter((unit) =>
      unit.name.toLowerCase().includes(query) || unit.product_type.toLowerCase().includes(query)
    )
  }, [shippingUnits, searchQuery])

  // Group by product_type
  const groupedUnits = useMemo(() => {
    const groups: Record<string, ShippingUnit[]> = {}
    for (const unit of filteredUnits) {
      if (!groups[unit.product_type]) {
        groups[unit.product_type] = []
      }
      groups[unit.product_type].push(unit)
    }
    return groups
  }, [filteredUnits])

  const formatRange = (min: number | null, max: number | null, suffix = '') => {
    if (min === null && max === null) return '—'
    if (min === null) return `≤ ${max}${suffix}`
    if (max === null) return `≥ ${min}${suffix}`
    if (min === max) return `${min}${suffix}`
    return `${min} – ${max}${suffix}`
  }

  const startCreate = () => {
    setEditingId('new')
    setForm(EMPTY_FORM)
    setSaveError(null)
  }

  const startEdit = (unit: ShippingUnit) => {
    setEditingId(unit.id)
    setForm({
      product_type: unit.product_type,
      pot_size_min: unit.pot_size_min !== null ? String(unit.pot_size_min) : '',
      pot_size_max: unit.pot_size_max !== null ? String(unit.pot_size_max) : '',
      height_min: unit.height_min !== null ? String(unit.height_min) : '',
      height_max: unit.height_max !== null ? String(unit.height_max) : '',
      is_fragile_filter: unit.is_fragile_filter === null ? 'all' : unit.is_fragile_filter ? 'true' : 'false',
      sort_order: String(unit.sort_order ?? 0),
    })
    setSaveError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setSaveError(null)
  }

  const handleSave = async () => {
    if (!form.product_type) {
      setSaveError(t.settings.productTypeRequired)
      return
    }

    setIsSaving(true)
    setSaveError(null)

    const name = namePreview
    const payload = {
      ...(editingId !== 'new' && { id: editingId }),
      name,
      product_type: form.product_type,
      pot_size_min: form.pot_size_min ? parseFloat(form.pot_size_min) : null,
      pot_size_max: form.pot_size_max ? parseFloat(form.pot_size_max) : null,
      height_min: form.height_min ? parseFloat(form.height_min) : null,
      height_max: form.height_max ? parseFloat(form.height_max) : null,
      is_fragile_filter: form.is_fragile_filter === 'all' ? null : form.is_fragile_filter === 'true',
      sort_order: parseInt(form.sort_order || '0', 10),
    }

    try {
      const method = editingId === 'new' ? 'POST' : 'PUT'
      const res = await fetch('/api/verpakking/shipping-units', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t.settings.saveFailed)
      }

      cancelEdit()
      await fetchData()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t.settings.unknownError)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const res = await fetch('/api/verpakking/shipping-units', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || t.settings.deleteFailed)
      }

      setDeleteConfirmId(null)
      await fetchData()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t.settings.unknownError)
      setDeleteConfirmId(null)
    } finally {
      setIsDeleting(false)
    }
  }

  const updateForm = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
          <p className="text-lg text-muted-foreground">{t.settings.loadingData}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">{t.settings.loadError}</p>
            <p className="text-sm">{error.message}</p>
          </div>
        </div>
      </div>
    )
  }

  // Inline form component
  const renderForm = () => (
    <div className="p-4 bg-card border border-primary/30 rounded-lg space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {editingId === 'new' ? t.settings.newShippingUnit : t.settings.edit}
        </h3>
        <button onClick={cancelEdit} className="p-1 hover:bg-muted rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Name preview */}
      <div className="px-3 py-2 bg-muted/50 rounded-md">
        <div className="text-[10px] text-muted-foreground uppercase font-medium mb-0.5">{t.settings.nameAutomatic}</div>
        <div className="text-sm font-semibold">{namePreview}</div>
      </div>

      {/* Product type */}
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">{t.settings.productType} *</label>
        <div className="flex gap-2">
          <select
            value={knownProductTypes.includes(form.product_type) ? form.product_type : '__custom'}
            onChange={(e) => {
              if (e.target.value === '__custom') {
                updateForm('product_type', '')
              } else {
                updateForm('product_type', e.target.value)
              }
            }}
            className="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
          >
            <option value="">{t.settings.chooseType}</option>
            {knownProductTypes.map(pt => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
            <option value="__custom">{t.settings.newType}</option>
          </select>
          {(!knownProductTypes.includes(form.product_type) && form.product_type !== '') && (
            <input
              type="text"
              value={form.product_type}
              onChange={(e) => updateForm('product_type', e.target.value)}
              placeholder={t.settings.newTypeName}
              className="flex-1 px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
            />
          )}
        </div>
      </div>

      {/* Ranges */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">{t.settings.potSize} (cm)</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="number"
                step="0.1"
                value={form.pot_size_min}
                onChange={(e) => updateForm('pot_size_min', e.target.value)}
                placeholder={t.settings.noMin}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.settings.emptyNoLowerBound}</div>
            </div>
            <span className="text-muted-foreground text-sm">{t.settings.upTo}</span>
            <div className="flex-1">
              <input
                type="number"
                step="0.1"
                value={form.pot_size_max}
                onChange={(e) => updateForm('pot_size_max', e.target.value)}
                placeholder={t.settings.noMax}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.settings.emptyNoUpperBound}</div>
            </div>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">{t.settings.plantHeight} (cm)</label>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <input
                type="number"
                step="0.1"
                value={form.height_min}
                onChange={(e) => updateForm('height_min', e.target.value)}
                placeholder={t.settings.noMin}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.settings.emptyNoLowerBound}</div>
            </div>
            <span className="text-muted-foreground text-sm">{t.settings.upTo}</span>
            <div className="flex-1">
              <input
                type="number"
                step="0.1"
                value={form.height_max}
                onChange={(e) => updateForm('height_max', e.target.value)}
                placeholder={t.settings.noMax}
                className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
              />
              <div className="text-[10px] text-muted-foreground mt-0.5">{t.settings.emptyNoUpperBound}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Fragile + Sort order */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">{t.settings.fragileFilter}</label>
          <select
            value={form.is_fragile_filter}
            onChange={(e) => updateForm('is_fragile_filter', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
          >
            <option value="all">{t.settings.allNoFilter}</option>
            <option value="true">{t.settings.onlyFragile}</option>
            <option value="false">{t.settings.onlyNonFragile}</option>
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">{t.settings.sortOrder}</label>
          <input
            type="number"
            value={form.sort_order}
            onChange={(e) => updateForm('sort_order', e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md text-sm bg-background min-h-[40px]"
          />
        </div>
      </div>

      {/* Overlap warning */}
      {overlaps.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
          <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-1">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {t.settings.overlapWith} {overlaps.length} {overlaps.length === 1 ? t.settings.unit : t.settings.units}
          </div>
          <div className="text-xs text-amber-600 space-y-0.5">
            {overlaps.map(u => (
              <div key={u.id}>{u.name} (sort: {u.sort_order})</div>
            ))}
          </div>
          <div className="text-[10px] text-amber-500 mt-1">
            {t.settings.overlapSortHint}
          </div>
        </div>
      )}

      {/* Save error */}
      {saveError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={cancelEdit}
          className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors min-h-[40px]"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || !form.product_type}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 min-h-[40px] inline-flex items-center gap-2"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {editingId === 'new' ? t.settings.create : t.common.save}
        </button>
      </div>
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package2 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">{t.settings.shippingUnits}</h2>
            <p className="text-sm text-muted-foreground">
              {shippingUnits.length} {t.settings.activeUnits}
            </p>
          </div>
        </div>
        {!editingId && (
          <button
            onClick={startCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            {t.settings.newUnit}
          </button>
        )}
      </div>

      {/* Create/Edit form */}
      {editingId === 'new' && renderForm()}

      {/* Search bar */}
      <div className="mb-6">
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder={t.settings.searchByNameOrType}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary min-h-[44px]"
          />
        </div>
      </div>

      {/* Global save error (from delete) */}
      {saveError && !editingId && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
          {saveError}
        </div>
      )}

      {/* Grouped shipping units */}
      {Object.keys(groupedUnits).length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Package2 className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {searchQuery ? t.common.noResults : t.settings.noShippingUnits}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedUnits)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([productType, units]) => (
              <div key={productType}>
                <h3 className="text-sm font-semibold text-muted-foreground uppercase mb-3">
                  {productType}
                </h3>
                <div className="space-y-2">
                  {units.map((unit) => (
                    <div key={unit.id}>
                      {/* Inline edit form */}
                      {editingId === unit.id ? (
                        renderForm()
                      ) : (
                        <div className="p-4 bg-card border border-border rounded-lg hover:bg-muted/20 transition-colors group">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-sm font-semibold mb-2">{unit.name}</h4>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{t.settings.potSize}:</span>
                                  <span className="font-medium">
                                    {formatRange(unit.pot_size_min, unit.pot_size_max, ' cm')}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{t.settings.plantHeight}:</span>
                                  <span className="font-medium">
                                    {formatRange(unit.height_min, unit.height_max, ' cm')}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">{t.settings.sortOrder}:</span>
                                  <span className="font-medium">{unit.sort_order}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {unit.is_fragile_filter && (
                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                  {t.settings.fragile}
                                </span>
                              )}
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {unit.product_count} {unit.product_count === 1 ? t.common.product : t.common.products}
                              </span>

                              {/* Edit/Delete buttons */}
                              {deleteConfirmId === unit.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleDelete(unit.id)}
                                    disabled={isDeleting}
                                    className="px-2 py-1 text-xs bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 transition-colors min-h-[32px]"
                                  >
                                    {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : t.settings.yesDelete}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(null)}
                                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted transition-colors min-h-[32px]"
                                  >
                                    {t.common.no}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => startEdit(unit)}
                                    className="p-1.5 rounded hover:bg-muted transition-colors"
                                    title={t.settings.edit}
                                  >
                                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirmId(unit.id)}
                                    className="p-1.5 rounded hover:bg-destructive/10 transition-colors"
                                    title={t.common.delete}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
